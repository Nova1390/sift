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
