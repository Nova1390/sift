import fs from 'node:fs';
import MiniSearch from 'minisearch';
import { parseClaudeFile } from './parse-claude.js';
import { parseCodexFile } from './parse-codex.js';
import { parseCursorFile } from './parse-cursor.js';
import { ensureIndexDir, findFilesNamed, findJsonlFiles, indexFile, sourceRoots } from './paths.js';
import { shortExcerpt } from './text.js';

export const miniSearchOptions = {
  fields: ['text'],
  storeFields: ['tool', 'session', 'role', 'ts', 'project', 'excerpt']
};

export function buildIndex() {
  const malformed = [];
  const records = [];
  const stats = {
    claude: { sessions: 0, messages: 0 },
    codex: { sessions: 0, messages: 0 },
    cursor: { sessions: 0, messages: 0 }
  };
  const warnings = [];

  const claudeFiles = findJsonlFiles(sourceRoots.claude);
  const codexFiles = [
    ...findJsonlFiles(sourceRoots.codexSessions),
    ...findJsonlFiles(sourceRoots.codexArchived)
  ];
  const cursorFiles = [
    ...findFilesNamed(sourceRoots.cursorMacUser, 'state.vscdb'),
    ...findFilesNamed(sourceRoots.cursorLinuxUser, 'state.vscdb'),
    ...findFilesNamed(sourceRoots.cursorWindowsUser, 'state.vscdb')
  ];
  const uniqueCursorFiles = [...new Set(cursorFiles)];

  for (const file of claudeFiles) {
    const parsed = parseClaudeFile(file, malformed);
    if (parsed.length) stats.claude.sessions += 1;
    stats.claude.messages += parsed.length;
    records.push(...parsed);
  }

  for (const file of codexFiles) {
    const parsed = parseCodexFile(file, malformed);
    if (parsed.length) stats.codex.sessions += 1;
    stats.codex.messages += parsed.length;
    records.push(...parsed);
  }

  if (!uniqueCursorFiles.length) {
    warnings.push('Cursor skipped: no state.vscdb files found');
  }

  for (const file of uniqueCursorFiles) {
    const parsed = parseCursorFile(file, warnings);
    if (parsed.length) stats.cursor.sessions += 1;
    stats.cursor.messages += parsed.length;
    records.push(...parsed);
  }

  const searchableRecords = records.map((record) => ({
    ...record,
    excerpt: shortExcerpt(record.text)
  }));

  const miniSearch = new MiniSearch(miniSearchOptions);
  miniSearch.addAll(searchableRecords);

  const payload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    stats,
    malformedCount: malformed.length,
    warnings,
    records: searchableRecords,
    miniSearch: miniSearch.toJSON()
  };

  ensureIndexDir();
  fs.writeFileSync(indexFile, JSON.stringify(payload), 'utf8');
  return { ...payload, indexFile, sourceCounts: { claude: claudeFiles.length, codex: codexFiles.length, cursor: uniqueCursorFiles.length } };
}

export function loadIndex() {
  if (!fs.existsSync(indexFile)) return null;
  const payload = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
  return {
    ...payload,
    indexFile,
    miniSearch: MiniSearch.loadJSON(JSON.stringify(payload.miniSearch), miniSearchOptions)
  };
}
