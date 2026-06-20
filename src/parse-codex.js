import path from 'node:path';
import { readJsonl } from './jsonl.js';
import { compactText, extractTextContent, toIso } from './text.js';

export function parseCodexFile(file, malformed = []) {
  const records = [];
  const seen = new Set();
  let project = inferProjectFromPath(file);

  readJsonl(
    file,
    (obj, lineNumber) => {
      if (obj.type === 'session_meta') {
        project = obj.payload?.cwd || project;
        return;
      }

      if (obj.type === 'turn_context') {
        project = obj.payload?.cwd || obj.payload?.workspace_roots?.[0] || project;
        return;
      }

      const message = extractMessage(obj);
      if (!message) return;

      const text = compactText(message.text);
      if (!text) return;

      const dedupeKey = `${message.role}\0${text}`;
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);

      records.push({
        id: `codex:${file}:${lineNumber}`,
        tool: 'codex',
        session: file,
        project,
        role: message.role,
        ts: toIso(obj.timestamp ?? obj.payload?.timestamp),
        text
      });
    },
    (source, line, error) => {
      malformed.push({ tool: 'codex', source, line, error: error.message });
    },
    {
      shouldParseLine: isUsefulCodexLine,
      shouldKeepLineStart: isUsefulCodexLineStart
    }
  );

  return records;
}

function isUsefulCodexLine(line) {
  return (
    line.includes('"session_meta"') ||
    line.includes('"turn_context"') ||
    line.includes('"type":"message"') ||
    line.includes('"user_message"') ||
    line.includes('"agent_message"')
  );
}

function isUsefulCodexLineStart(line) {
  return isUsefulCodexLine(line);
}

function extractMessage(obj) {
  if (obj.type === 'response_item' && obj.payload?.type === 'message') {
    const role = obj.payload.role;
    if (role !== 'user' && role !== 'assistant') return null;
    return { role, text: extractTextContent(obj.payload.content) };
  }

  if (obj.type !== 'event_msg') return null;

  if (obj.payload?.type === 'user_message') {
    return { role: 'user', text: obj.payload.message };
  }

  if (obj.payload?.type === 'agent_message') {
    return { role: 'assistant', text: obj.payload.message };
  }

  return null;
}

function inferProjectFromPath(file) {
  const name = path.basename(file, '.jsonl');
  return name.replace(/^rollout-\d{4}-\d{2}-\d{2}T[\d-]+-/, '');
}
