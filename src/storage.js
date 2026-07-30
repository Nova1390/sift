import fs from 'node:fs';
import path from 'node:path';

const privateDirectoryMode = 0o700;
const privateFileMode = 0o600;

export function ensurePrivateDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: privateDirectoryMode });
  if (process.platform !== 'win32') {
    fs.chmodSync(dir, privateDirectoryMode);
  }
}

export function atomicWriteJson(file, value) {
  ensurePrivateDir(path.dirname(file));
  const tempFile = `${file}.tmp-${process.pid}-${Date.now()}`;
  let fd;

  try {
    fd = fs.openSync(tempFile, 'wx', privateFileMode);
    fs.writeFileSync(fd, JSON.stringify(value), 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(tempFile, file);
    secureFile(file);
  } catch (error) {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        // Preserve the original write error.
      }
    }
    try {
      fs.unlinkSync(tempFile);
    } catch {
      // The temporary file may not have been created or may already be gone.
    }
    throw error;
  }
}

export function secureFile(file) {
  if (process.platform !== 'win32') {
    fs.chmodSync(file, privateFileMode);
  }
}

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function fileMode(file) {
  if (process.platform === 'win32') return null;
  return fs.statSync(file).mode & 0o777;
}

export function directorySize(dir) {
  let size = 0;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }

  for (const entry of entries) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      size += directorySize(file);
    } else if (entry.isFile()) {
      size += fs.statSync(file).size;
    }
  }
  return size;
}
