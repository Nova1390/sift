import fs from 'node:fs';
import { createRequire } from 'node:module';
import { indexPayloadVersion, loadIndex } from './index.js';
import { sourceRoots, storagePaths } from './paths.js';
import { discoverSources, statSource } from './sources.js';
import { directorySize, fileMode } from './storage.js';

const require = createRequire(import.meta.url);

export function runDoctor({
  roots = sourceRoots,
  storage = storagePaths
} = {}) {
  const discovered = discoverSources(roots);
  const warnings = [];
  const errors = [];
  let loaded = null;

  try {
    loaded = loadIndex(storage);
  } catch (error) {
    errors.push(error.message);
  }

  if (!loaded && !errors.length) {
    errors.push('No index found yet. Run: sift index');
  }
  if (loaded && loaded.formatVersion !== indexPayloadVersion) {
    errors.push(`Index format v${loaded.formatVersion} is outdated. Run: sift index`);
  }

  const totalSources = discovered.claude.length + discovered.codex.length + discovered.cursor.length;
  if (!totalSources) {
    errors.push('No Claude Code, Codex, or Cursor source files were found');
  }

  const sqliteAvailable = hasBetterSqlite();
  if (!discovered.cursor.length) {
    warnings.push('Cursor is not installed or no state.vscdb files were found');
  } else if (!sqliteAvailable) {
    warnings.push('Cursor databases were found, but better-sqlite3 is unavailable');
  }

  const changes = summarizeChanges(compareSources(discovered.files, loaded?.sourceManifest ?? {}));
  const indexInfo = inspectStorage(storage, loaded);
  if (process.platform !== 'win32') {
    if (indexInfo.directoryMode && indexInfo.directoryMode !== '700') {
      errors.push(`Index directory permissions are ${indexInfo.directoryMode}; expected 700`);
    }
    if (indexInfo.fileMode && indexInfo.fileMode !== '600') {
      errors.push(`Index file permissions are ${indexInfo.fileMode}; expected 600`);
    }
    if (indexInfo.cacheDirectoryMode && indexInfo.cacheDirectoryMode !== '700') {
      errors.push(`Cache directory permissions are ${indexInfo.cacheDirectoryMode}; expected 700`);
    }
    if (indexInfo.insecureCacheFiles > 0) {
      errors.push(`${indexInfo.insecureCacheFiles} cache shard(s) do not have 600 permissions`);
    }
  }

  return {
    ok: errors.length === 0,
    index: indexInfo,
    sources: {
      claude: { files: discovered.claude.length },
      codex: { files: discovered.codex.length },
      cursor: {
        databases: discovered.cursor.length,
        sqliteAvailable,
        refreshRequired: discovered.cursor.length
      }
    },
    changes,
    stats: loaded?.stats ?? null,
    warnings: [...new Set([...(loaded?.warnings ?? []), ...warnings])],
    errors
  };
}

export function formatDoctor(result) {
  const lines = [
    `sift doctor: ${result.ok ? 'ok' : 'attention required'}`,
    `  index: ${formatIndex(result.index)}`,
    `  permissions: index ${result.index.fileMode ?? 'n/a'}, cache ${result.index.cacheDirectoryMode ?? 'n/a'}, insecure shards ${result.index.insecureCacheFiles}`,
    `  claude: ${result.sources.claude.files} file(s)`,
    `  codex: ${result.sources.codex.files} file(s)`,
    `  cursor: ${result.sources.cursor.databases} db(s), SQLite ${result.sources.cursor.sqliteAvailable ? 'available' : 'unavailable'}`,
    `  changes: ${result.changes.new} new, ${result.changes.modified} modified, ${result.changes.deleted} deleted`
  ];

  for (const warning of result.warnings) lines.push(`  warning: ${warning}`);
  for (const error of result.errors) lines.push(`  error: ${error}`);
  return lines.join('\n');
}

function summarizeChanges(changes) {
  return {
    new: changes.new.length,
    modified: changes.modified.length,
    deleted: changes.deleted.length,
    samples: {
      new: changes.new.slice(0, 5),
      modified: changes.modified.slice(0, 5),
      deleted: changes.deleted.slice(0, 5)
    }
  };
}

function compareSources(files, manifest) {
  const current = new Set(files.map(({ file }) => file));
  const added = [];
  const modified = [];

  for (const { file, tool } of files) {
    const entry = manifest[file];
    if (!entry) {
      added.push(file);
      continue;
    }
    if (tool === 'cursor') continue;
    try {
      const stat = statSource(file);
      if (entry.mtimeMs !== stat.mtimeMs || entry.size !== stat.size) {
        modified.push(file);
      }
    } catch {
      modified.push(file);
    }
  }

  return {
    new: added,
    modified,
    deleted: Object.keys(manifest).filter((file) => !current.has(file))
  };
}

function inspectStorage(storage, loaded) {
  const exists = fs.existsSync(storage.indexFile);
  return {
    exists,
    file: storage.indexFile,
    version: loaded?.formatVersion ?? null,
    generatedAt: loaded?.generatedAt ?? null,
    sizeBytes: exists ? fs.statSync(storage.indexFile).size : 0,
    cacheBytes: directorySize(storage.cacheDir),
    directoryMode: modeString(storage.indexDir),
    fileMode: exists ? modeString(storage.indexFile) : null,
    cacheDirectoryMode: modeString(storage.cacheDir),
    insecureCacheFiles: countInsecureCacheFiles(storage.cacheDir)
  };
}

function countInsecureCacheFiles(cacheDir) {
  if (process.platform === 'win32') return 0;
  let entries;
  try {
    entries = fs.readdirSync(cacheDir, { withFileTypes: true });
  } catch {
    return 0;
  }
  return entries.filter((entry) => (
    entry.isFile() && modeString(`${cacheDir}/${entry.name}`) !== '600'
  )).length;
}

function modeString(file) {
  try {
    const mode = fileMode(file);
    return mode === null ? null : mode.toString(8).padStart(3, '0');
  } catch {
    return null;
  }
}

function formatIndex(index) {
  if (!index.exists) return 'missing';
  const totalSize = index.sizeBytes + index.cacheBytes;
  return `v${index.version ?? 'unknown'}, ${formatBytes(totalSize)}, generated ${index.generatedAt ?? 'unknown'}`;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function hasBetterSqlite() {
  try {
    require.resolve('better-sqlite3');
    return true;
  } catch {
    return false;
  }
}
