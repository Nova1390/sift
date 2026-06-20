import fs from 'node:fs';

export function readJsonl(file, onObject, onMalformed, options = {}) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
  } catch (error) {
    onMalformed?.(file, 0, error);
    return;
  }

  const buffer = Buffer.allocUnsafe(64 * 1024);
  let parts = [];
  let lineLength = 0;
  let skippingLine = false;
  let lineStartAccepted = false;
  let lineNumber = 0;

  try {
    while (true) {
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;

      const data = Buffer.from(buffer.subarray(0, bytesRead));
      let start = 0;

      for (let i = 0; i < data.length; i += 1) {
        if (data[i] !== 10) continue;
        appendSegment(data.subarray(start, i));
        finishLine();
        start = i + 1;
      }

      appendSegment(data.subarray(start));
    }

    if (lineLength || skippingLine) finishLine();
  } finally {
    fs.closeSync(fd);
  }

  function appendSegment(segment) {
    if (!segment.length || skippingLine) return;
    parts.push(segment);
    lineLength += segment.length;

    if (!lineStartAccepted && options.shouldKeepLineStart && lineLength >= 4096) {
      const prefix = Buffer.concat(parts, Math.min(lineLength, 4096)).toString('utf8');
      if (!options.shouldKeepLineStart(prefix)) {
        parts = [];
        lineLength = 0;
        skippingLine = true;
      } else {
        lineStartAccepted = true;
      }
    }
  }

  function finishLine() {
    if (skippingLine) {
      lineNumber += 1;
      skippingLine = false;
      lineStartAccepted = false;
      return;
    }

    const rawLine = parts.length === 1 ? parts[0] : Buffer.concat(parts, lineLength);
    parts = [];
    lineLength = 0;
    lineStartAccepted = false;
    parseLine(rawLine);
  }

  function parseLine(rawLine) {
    lineNumber += 1;
    let line = rawLine;
    if (line.length && line[line.length - 1] === 13) {
      line = line.subarray(0, line.length - 1);
    }
    const text = line.toString('utf8').trim();
    if (!text) return;

    if (options.shouldParseLine && !options.shouldParseLine(text)) return;

    try {
      onObject(JSON.parse(text), lineNumber);
    } catch (error) {
      onMalformed?.(file, lineNumber, error);
    }
  }
}
