import fs from 'node:fs';
import { findFilesNamed, findJsonlFiles, sourceRoots } from './paths.js';

export function discoverSources(roots = sourceRoots) {
  const claude = findJsonlFiles(roots.claude);
  const codex = [...new Set([
    ...findJsonlFiles(roots.codexSessions),
    ...findJsonlFiles(roots.codexArchived)
  ])].sort();
  const cursor = [...new Set([
    ...findFilesNamed(roots.cursorMacUser, 'state.vscdb'),
    ...findFilesNamed(roots.cursorLinuxUser, 'state.vscdb'),
    ...findFilesNamed(roots.cursorWindowsUser, 'state.vscdb')
  ])];
  const opencode = roots.opencodeDb && fs.existsSync(roots.opencodeDb)
    ? [roots.opencodeDb]
    : [];

  return {
    claude,
    codex,
    cursor: cursor.sort(),
    opencode,
    files: [
      ...claude.map((file) => ({ file, tool: 'claude' })),
      ...codex.map((file) => ({ file, tool: 'codex' })),
      ...cursor.map((file) => ({ file, tool: 'cursor' })),
      ...opencode.map((file) => ({ file, tool: 'opencode' }))
    ]
  };
}

export function statSource(file) {
  const stat = fs.statSync(file);
  return { mtimeMs: stat.mtimeMs, size: stat.size };
}
