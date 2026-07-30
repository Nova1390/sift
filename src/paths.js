import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensurePrivateDir } from './storage.js';

export const homeDir = os.homedir();
export const indexDir = path.join(homeDir, '.sift');
export const indexFile = path.join(indexDir, 'index.json');

export const sourceRoots = {
  claude: path.join(homeDir, '.claude', 'projects'),
  codexSessions: path.join(homeDir, '.codex', 'sessions'),
  codexArchived: path.join(homeDir, '.codex', 'archived_sessions'),
  cursorMacUser: path.join(homeDir, 'Library', 'Application Support', 'Cursor', 'User'),
  cursorLinuxUser: path.join(homeDir, '.config', 'Cursor', 'User'),
  cursorWindowsUser: process.env.APPDATA ? path.join(process.env.APPDATA, 'Cursor', 'User') : null
};

export function ensureIndexDir() {
  ensurePrivateDir(indexDir);
}

export function findJsonlFiles(root) {
  const files = [];
  walk(root, files, (entry) => entry.isFile() && entry.name.endsWith('.jsonl'));
  return files.sort();
}

export function findFilesNamed(root, name) {
  const files = [];
  walk(root, files, (entry) => entry.isFile() && entry.name === name);
  return files.sort();
}

function walk(dir, files, include) {
  if (!dir) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, files, include);
    } else if (include(entry)) {
      files.push(fullPath);
    }
  }
}
