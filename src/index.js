import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import MiniSearch from 'minisearch';
import { parseClaudeFile } from './parse-claude.js';
import { parseCodexFile } from './parse-codex.js';
import { parseCursorFile } from './parse-cursor.js';
import { parseOpenCodeFile } from './parse-opencode.js';
import { createStoragePaths, sourceRoots, storagePaths } from './paths.js';
import { discoverSources, statSource } from './sources.js';
import { atomicWriteJson, ensurePrivateDir, readJson } from './storage.js';

export const indexPayloadVersion = 4;
const legacyIndexPayloadVersion = 3;
const shortRefLength = 12;
const alwaysRefreshTools = new Set(['cursor', 'opencode']);

export const miniSearchOptions = {
  fields: ['text'],
  storeFields: ['tool', 'session', 'role', 'ts', 'project'],
  autoVacuum: false
};

const legacyMiniSearchOptions = {
  fields: ['text'],
  storeFields: ['tool', 'session', 'role', 'ts', 'project', 'excerpt']
};

export async function buildIndex({
  full = false,
  roots = sourceRoots,
  storage: storageInput = storagePaths
} = {}) {
  const storage = normalizeStorage(storageInput);
  ensurePrivateDir(storage.indexDir);
  ensurePrivateDir(storage.cacheDir);

  const warnings = [];
  const previousPayload = full ? null : readExistingIndexPayload(storage.indexFile);
  const previous = loadPreviousV4(previousPayload, storage);
  if (previousPayload?.version === indexPayloadVersion && !previous) {
    warnings.push('Existing v4 index could not be reused; rebuilding it from source logs');
  }

  const previousManifest = previous?.payload.sourceManifest ?? {};
  const miniSearch = previous?.miniSearch ?? new MiniSearch(miniSearchOptions);
  const sourceManifest = {};
  const cacheStats = {
    reused: emptyToolCounts(),
    parsed: emptyToolCounts(),
    removed: emptyToolCounts()
  };
  const discovered = discoverSources(roots);
  const currentPaths = new Set(discovered.files.map(({ file }) => file));
  const generation = `${Date.now().toString(36)}-${process.pid}`;

  if (!discovered.cursor.length) {
    warnings.push('Cursor skipped: no state.vscdb files found');
  }
  if (!discovered.opencode.length) {
    warnings.push('OpenCode skipped: no opencode.db file found');
  }

  for (const { file, tool } of discovered.files) {
    const cached = previousManifest[file];
    let stat;
    try {
      stat = statSource(file);
    } catch (error) {
      warnings.push(`Skipped ${file}: ${error.message}`);
      if (cached && shardExists(storage, cached)) {
        sourceManifest[file] = cached;
        cacheStats.reused[tool] += 1;
      }
      continue;
    }

    // SQLite WAL changes may not update the main database file metadata.
    if (!alwaysRefreshTools.has(tool) && isReusableSource(cached, stat, tool, storage)) {
      sourceManifest[file] = cached;
      cacheStats.reused[tool] += 1;
      continue;
    }

    if (cached) {
      discardSource(miniSearch, cached);
    }

    const parsed = parseSource(tool, file);
    const sourceHash = hashSource(file);
    const records = parsed.records.map((record, offset) => ({
      ...record,
      id: documentId(sourceHash, offset)
    }));
    const cacheFile = `${sourceHash}-${generation}.json`;

    atomicWriteJson(path.join(storage.cacheDir, cacheFile), {
      version: 1,
      source: file,
      tool,
      records
    });

    if (records.length) {
      miniSearch.addAll(records);
    }

    sourceManifest[file] = {
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      tool,
      sourceHash,
      cacheFile,
      recordCount: records.length,
      sessions: summarizeSessions(records),
      malformedCount: parsed.malformedCount,
      warnings: parsed.warnings
    };
    cacheStats.parsed[tool] += 1;
  }

  for (const [file, entry] of Object.entries(previousManifest)) {
    if (currentPaths.has(file)) continue;
    discardSource(miniSearch, entry);
    cacheStats.removed[entry.tool] += 1;
  }

  if (miniSearch.dirtCount > 0) {
    await miniSearch.vacuum({
      batchSize: miniSearch.termCount + 1,
      batchWait: 0
    });
  }

  const sessions = aggregateSessions(sourceManifest);
  const stats = calculateManifestStats(sourceManifest, sessions);
  const malformedCount = Object.values(sourceManifest)
    .reduce((sum, entry) => sum + (entry.malformedCount ?? 0), 0);

  for (const entry of Object.values(sourceManifest)) {
    warnings.push(...(entry.warnings ?? []));
  }
  if (discovered.cursor.length && stats.cursor.messages === 0) {
    warnings.push(`Cursor: found ${discovered.cursor.length} db(s) but 0 messages extracted`);
  }
  if (discovered.opencode.length && stats.opencode.messages === 0) {
    warnings.push(`OpenCode: found ${discovered.opencode.length} db(s) but 0 messages extracted`);
  }

  const payload = {
    version: indexPayloadVersion,
    generatedAt: new Date().toISOString(),
    stats,
    malformedCount,
    warnings: [...new Set(warnings)],
    cacheStats,
    sourceManifest,
    sessions,
    miniSearch: miniSearch.toJSON()
  };

  atomicWriteJson(storage.indexFile, payload);
  cleanupCache(storage, sourceManifest);

  return {
    ...payload,
    indexFile: storage.indexFile,
    storage,
    sourceCounts: {
      claude: discovered.claude.length,
      codex: discovered.codex.length,
      cursor: discovered.cursor.length,
      opencode: discovered.opencode.length
    }
  };
}

export function loadIndex(storageInput = storagePaths) {
  const storage = normalizeStorage(storageInput);
  if (!fs.existsSync(storage.indexFile)) return null;

  let payload;
  try {
    payload = readJson(storage.indexFile);
  } catch {
    throw new Error('The sift index is corrupt. Run: sift index --full');
  }

  try {
    if (payload.version === indexPayloadVersion) {
      if (!payload.sourceManifest || !Array.isArray(payload.sessions) || !payload.miniSearch) {
        throw new Error('invalid v4 payload');
      }
      const miniSearch = MiniSearch.loadJS(payload.miniSearch, miniSearchOptions);
      return createLoadedV4(payload, miniSearch, storage);
    }

    if (payload.version === legacyIndexPayloadVersion && payload.miniSearch) {
      const records = payload.fileCache
        ? recordsFromFileCache(payload.fileCache)
        : payload.records ?? [];
      return {
        ...payload,
        formatVersion: legacyIndexPayloadVersion,
        records,
        indexFile: storage.indexFile,
        storage,
        miniSearch: MiniSearch.loadJS(payload.miniSearch, legacyMiniSearchOptions)
      };
    }
  } catch {
    throw new Error('The sift index is incompatible. Run: sift index --full');
  }

  throw new Error('The sift index is outdated. Run: sift index --full');
}

export function loadRecord(loaded, id) {
  if (loaded.formatVersion !== indexPayloadVersion) {
    return loaded.records?.find((record) => record.id === id) ?? null;
  }

  const parsed = parseDocumentId(id);
  if (!parsed) return null;
  const entry = loaded.sourceByHash.get(parsed.sourceHash);
  if (!entry) return null;
  const records = loadShardRecords(loaded, entry);
  const record = records[parsed.offset];
  return record?.id === id ? record : null;
}

export function resolveRecordRef(loaded, ref) {
  if (loaded.formatVersion !== indexPayloadVersion) {
    throw new Error('sift show requires a v4 index. Run: sift index');
  }

  const parsed = parseRecordRef(ref);
  if (!parsed) {
    throw new Error('Invalid result ref. Expected a value like a13f09c2e4ab:17');
  }

  const matches = [...loaded.sourceByHash.keys()]
    .filter((hash) => hash.startsWith(parsed.sourcePrefix));
  if (!matches.length) throw new Error(`No indexed result matches ref ${ref}`);
  if (matches.length > 1) throw new Error(`Result ref ${ref} is ambiguous; use a longer hash prefix`);

  const id = documentId(matches[0], parsed.offset);
  const record = loadRecord(loaded, id);
  if (!record) throw new Error(`No indexed result matches ref ${ref}`);
  return { id, record, entry: loaded.sourceByHash.get(matches[0]) };
}

export function resultRef(loaded, id) {
  if (loaded.formatVersion !== indexPayloadVersion) return null;
  const parsed = parseDocumentId(id);
  if (!parsed) return null;

  let length = Math.min(shortRefLength, parsed.sourceHash.length);
  const hashes = [...loaded.sourceByHash.keys()];
  while (
    length < parsed.sourceHash.length &&
    hashes.some((hash) => hash !== parsed.sourceHash && hash.startsWith(parsed.sourceHash.slice(0, length)))
  ) {
    length += 1;
  }
  return `${parsed.sourceHash.slice(0, length)}:${parsed.offset}`;
}

export function loadSourceRecords(loaded, entry) {
  return loadShardRecords(loaded, entry);
}

export function calculateStats(fileCache) {
  const stats = emptyStats();
  const sessions = Object.fromEntries(Object.keys(stats).map((tool) => [tool, new Set()]));

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

function loadPreviousV4(payload, storage) {
  if (
    payload?.version !== indexPayloadVersion ||
    !payload.sourceManifest ||
    !payload.miniSearch
  ) {
    return null;
  }

  try {
    const miniSearch = MiniSearch.loadJS(payload.miniSearch, miniSearchOptions);
    const expectedDocuments = Object.values(payload.sourceManifest)
      .reduce((sum, entry) => sum + (entry.recordCount ?? 0), 0);
    if (miniSearch.documentCount !== expectedDocuments) return null;
    return { payload, miniSearch, storage };
  } catch {
    return null;
  }
}

function createLoadedV4(payload, miniSearch, storage) {
  const sourceByHash = new Map();
  for (const entry of Object.values(payload.sourceManifest)) {
    if (entry.sourceHash) sourceByHash.set(entry.sourceHash, entry);
  }
  return {
    ...payload,
    formatVersion: indexPayloadVersion,
    indexFile: storage.indexFile,
    storage,
    miniSearch,
    sourceByHash,
    shardCache: new Map()
  };
}

function parseSource(tool, file) {
  if (tool === 'cursor' || tool === 'opencode') {
    const warnings = [];
    return {
      records: tool === 'cursor'
        ? parseCursorFile(file, warnings)
        : parseOpenCodeFile(file, warnings),
      malformedCount: 0,
      warnings
    };
  }

  const malformed = [];
  const records = tool === 'claude'
    ? parseClaudeFile(file, malformed)
    : parseCodexFile(file, malformed);
  return {
    records,
    malformedCount: malformed.length,
    warnings: []
  };
}

function isReusableSource(entry, stat, tool, storage) {
  return Boolean(
    entry &&
    entry.tool === tool &&
    entry.mtimeMs === stat.mtimeMs &&
    entry.size === stat.size &&
    Number.isInteger(entry.recordCount) &&
    entry.sourceHash &&
    shardExists(storage, entry)
  );
}

function discardSource(miniSearch, entry) {
  if (!entry?.sourceHash || !entry.recordCount) return;
  const ids = Array.from(
    { length: entry.recordCount },
    (_, offset) => documentId(entry.sourceHash, offset)
  );
  miniSearch.discardAll(ids);
}

function summarizeSessions(records) {
  const sessions = new Map();
  for (const record of records) {
    const existing = sessions.get(record.session);
    if (!existing) {
      sessions.set(record.session, {
        tool: record.tool,
        session: record.session,
        project: record.project,
        ts: record.ts,
        messages: 1
      });
      continue;
    }
    existing.messages += 1;
    if (compareTs(record.ts, existing.ts) > 0) existing.ts = record.ts;
  }
  return [...sessions.values()];
}

function aggregateSessions(sourceManifest) {
  const sessions = new Map();
  for (const entry of Object.values(sourceManifest)) {
    for (const session of entry.sessions ?? []) {
      const key = `${session.tool}\0${session.session}`;
      const existing = sessions.get(key);
      if (!existing) {
        sessions.set(key, { ...session });
        continue;
      }
      existing.messages += session.messages;
      if (compareTs(session.ts, existing.ts) > 0) existing.ts = session.ts;
    }
  }
  return [...sessions.values()].sort((a, b) => compareTs(b.ts, a.ts));
}

function calculateManifestStats(sourceManifest, sessions) {
  const stats = emptyStats();
  for (const entry of Object.values(sourceManifest)) {
    if (stats[entry.tool]) stats[entry.tool].messages += entry.recordCount ?? 0;
  }
  for (const session of sessions) {
    if (stats[session.tool]) stats[session.tool].sessions += 1;
  }
  return stats;
}

function emptyStats() {
  return {
    claude: { sessions: 0, messages: 0 },
    codex: { sessions: 0, messages: 0 },
    cursor: { sessions: 0, messages: 0 },
    opencode: { sessions: 0, messages: 0 }
  };
}

function emptyToolCounts() {
  return { claude: 0, codex: 0, cursor: 0, opencode: 0 };
}

function cleanupCache(storage, sourceManifest) {
  const referenced = new Set(Object.values(sourceManifest).map((entry) => entry.cacheFile));
  let entries;
  try {
    entries = fs.readdirSync(storage.cacheDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isFile() || referenced.has(entry.name)) continue;
    try {
      fs.unlinkSync(path.join(storage.cacheDir, entry.name));
    } catch {
      // Orphan cleanup is best-effort and never invalidates the published manifest.
    }
  }
}

function loadShardRecords(loaded, entry) {
  if (loaded.shardCache.has(entry.cacheFile)) {
    return loaded.shardCache.get(entry.cacheFile);
  }
  const payload = readJson(shardPath(loaded.storage, entry.cacheFile));
  if (!payload || !Array.isArray(payload.records)) {
    throw new Error(`Index cache shard is corrupt: ${entry.cacheFile}. Run: sift index --full`);
  }
  loaded.shardCache.set(entry.cacheFile, payload.records);
  return payload.records;
}

function shardExists(storage, entry) {
  try {
    return fs.existsSync(shardPath(storage, entry.cacheFile));
  } catch {
    return false;
  }
}

function shardPath(storage, cacheFile) {
  if (!cacheFile || path.basename(cacheFile) !== cacheFile) {
    throw new Error('Invalid cache shard path');
  }
  return path.join(storage.cacheDir, cacheFile);
}

function readExistingIndexPayload(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return readJson(file);
  } catch {
    return null;
  }
}

function recordsFromFileCache(fileCache = {}) {
  return Object.keys(fileCache)
    .sort()
    .flatMap((file) => fileCache[file].records ?? []);
}

function normalizeStorage(input) {
  if (typeof input === 'string') {
    return createStoragePaths(path.dirname(input));
  }
  return input ?? storagePaths;
}

function hashSource(file) {
  return createHash('sha256').update(path.resolve(file)).digest('hex');
}

function documentId(sourceHash, offset) {
  return `${sourceHash}:${offset}`;
}

function parseDocumentId(id) {
  const match = String(id ?? '').match(/^([a-f0-9]{64}):(\d+)$/);
  if (!match) return null;
  return { sourceHash: match[1], offset: Number.parseInt(match[2], 10) };
}

function parseRecordRef(ref) {
  const match = String(ref ?? '').trim().match(/^([a-f0-9]{4,64}):(\d+)$/i);
  if (!match) return null;
  return {
    sourcePrefix: match[1].toLowerCase(),
    offset: Number.parseInt(match[2], 10)
  };
}

function compareTs(a, b) {
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;
  return a.localeCompare(b);
}
