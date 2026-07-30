import fs from 'node:fs';
import MiniSearch from 'minisearch';
import { parseClaudeFile } from './parse-claude.js';
import { parseCodexFile } from './parse-codex.js';
import { parseCursorFile } from './parse-cursor.js';
import { ensureIndexDir, findFilesNamed, findJsonlFiles, indexFile, sourceRoots } from './paths.js';
import { atomicWriteJson } from './storage.js';
import { shortExcerpt } from './text.js';

export const miniSearchOptions = {
  fields: ['text'],
  storeFields: ['tool', 'session', 'role', 'ts', 'project', 'excerpt']
};

const indexPayloadVersion = 3;

export function buildIndex({ full = false } = {}) {
  const malformed = [];
  const warnings = [];
  const previousPayload = full ? null : readExistingIndexPayload();
  const previousFileCache = previousPayload?.version === indexPayloadVersion &&
    previousPayload?.fileCache &&
    typeof previousPayload.fileCache === 'object'
    ? previousPayload.fileCache
    : {};
  const fileCache = {};
  const cacheStats = {
    reused: { claude: 0, codex: 0, cursor: 0 },
    parsed: { claude: 0, codex: 0, cursor: 0 }
  };

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

  if (!uniqueCursorFiles.length) {
    warnings.push('Cursor skipped: no state.vscdb files found');
  }

  for (const { file, tool } of [
    ...claudeFiles.map((file) => ({ file, tool: 'claude' })),
    ...codexFiles.map((file) => ({ file, tool: 'codex' })),
    ...uniqueCursorFiles.map((file) => ({ file, tool: 'cursor' }))
  ]) {
    const stat = statSourceFile(file, warnings);
    if (!stat) continue;

    const cached = previousFileCache[file];
    if (tool !== 'cursor' && isReusableCacheEntry(cached, stat, tool)) {
      fileCache[file] = cached;
      cacheStats.reused[tool] += 1;
      continue;
    }

    // Cursor can update via SQLite WAL files without touching state.vscdb mtime, so always re-parse it.
    const parsed = parseFileByTool(tool, file, malformed, warnings);
    cacheStats.parsed[tool] += 1;
    fileCache[file] = {
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      tool,
      records: withExcerpt(parsed)
    };
  }

  const records = recordsFromFileCache(fileCache);
  const stats = calculateStats(fileCache);

  if (uniqueCursorFiles.length && stats.cursor.messages === 0) {
    warnings.push(`Cursor: found ${uniqueCursorFiles.length} db(s) but 0 messages extracted`);
  }

  const miniSearch = new MiniSearch(miniSearchOptions);
  miniSearch.addAll(records);

  const payload = {
    version: indexPayloadVersion,
    generatedAt: new Date().toISOString(),
    stats,
    malformedCount: malformed.length,
    warnings,
    cacheStats,
    fileCache,
    miniSearch: miniSearch.toJSON()
  };

  ensureIndexDir();
  atomicWriteJson(indexFile, payload);
  return { ...payload, indexFile, cacheStats, sourceCounts: { claude: claudeFiles.length, codex: codexFiles.length, cursor: uniqueCursorFiles.length } };
}

export function loadIndex(file = indexFile) {
  if (!fs.existsSync(file)) return null;

  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    throw new Error('The sift index is corrupt. Run: sift index --full');
  }

  if (!payload || typeof payload !== 'object' || !payload.miniSearch) {
    throw new Error('The sift index is incompatible. Run: sift index --full');
  }

  const records = payload.fileCache
    ? recordsFromFileCache(payload.fileCache)
    : payload.records ?? [];

  try {
    return {
      ...payload,
      records,
      indexFile: file,
      miniSearch: MiniSearch.loadJS(payload.miniSearch, miniSearchOptions)
    };
  } catch (error) {
    if (error.code === 'ENOENT') throw error;
    throw new Error('The sift index is incompatible. Run: sift index --full');
  }
}

function readExistingIndexPayload() {
  if (!fs.existsSync(indexFile)) return null;

  try {
    return JSON.parse(fs.readFileSync(indexFile, 'utf8'));
  } catch {
    return null;
  }
}

function statSourceFile(file, warnings) {
  try {
    const stat = fs.statSync(file);
    return { mtimeMs: stat.mtimeMs, size: stat.size };
  } catch (error) {
    warnings.push(`Skipped ${file}: ${error.message}`);
    return null;
  }
}

function isReusableCacheEntry(cached, stat, tool) {
  return Boolean(
    cached &&
    cached.tool === tool &&
    cached.mtimeMs === stat.mtimeMs &&
    cached.size === stat.size &&
    Array.isArray(cached.records)
  );
}

function parseFileByTool(tool, file, malformed, warnings) {
  if (tool === 'claude') return parseClaudeFile(file, malformed);
  if (tool === 'codex') return parseCodexFile(file, malformed);
  return parseCursorFile(file, warnings);
}

function withExcerpt(records) {
  return records.map((record) => ({
    ...record,
    excerpt: shortExcerpt(record.text)
  }));
}

function recordsFromFileCache(fileCache = {}) {
  return Object.keys(fileCache)
    .sort()
    .flatMap((file) => fileCache[file].records ?? []);
}

export function calculateStats(fileCache) {
  const stats = {
    claude: { sessions: 0, messages: 0 },
    codex: { sessions: 0, messages: 0 },
    cursor: { sessions: 0, messages: 0 }
  };
  const sessions = {
    claude: new Set(),
    codex: new Set(),
    cursor: new Set()
  };

  for (const entry of Object.values(fileCache)) {
    const toolStats = stats[entry.tool];
    if (!toolStats) continue;
    for (const record of entry.records ?? []) {
      toolStats.messages += 1;
      if (record.session) sessions[entry.tool].add(record.session);
    }
  }

  for (const tool of Object.keys(stats)) {
    stats[tool].sessions = sessions[tool].size;
  }

  return stats;
}
