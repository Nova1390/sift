import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const homeDir = os.homedir();
export const indexDir = path.join(homeDir, '.sift');
export const indexFile = path.join(indexDir, 'index.json');

export const sourceRoots = {
  claude: path.join(homeDir, '.claude', 'projects'),
  codexSessions: path.join(homeDir, '.codex', 'sessions'),
  codexArchived: path.join(homeDir, '.codex', 'archived_sessions')
};

export function ensureIndexDir() {
  fs.mkdirSync(indexDir, { recursive: true });
}

export function findJsonlFiles(root) {
  const files = [];
  walk(root, files);
  return files.sort();
}

function walk(dir, files) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, files);
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      files.push(fullPath);
    }
  }
}
