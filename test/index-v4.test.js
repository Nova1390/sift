import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import MiniSearch from 'minisearch';
import { runDoctor } from '../src/doctor.js';
import {
  buildIndex,
  indexPayloadVersion,
  loadIndex
} from '../src/index.js';
import { createStoragePaths } from '../src/paths.js';
import { listSessions, searchIndex, showRecord } from '../src/search.js';
import { atomicWriteJson } from '../src/storage.js';

const require = createRequire(import.meta.url);
const fixtureDir = path.join(import.meta.dirname, 'fixtures');

test('v4 index shards records and incrementally updates changed and deleted sources', async () => {
  const env = createFixtureEnvironment();
  const first = await buildIndex({ full: true, roots: env.roots, storage: env.storage });

  assert.equal(first.version, indexPayloadVersion);
  assert.equal(first.fileCache, undefined);
  assert.deepEqual(first.stats.claude, { sessions: 1, messages: 2 });
  assert.deepEqual(first.stats.codex, { sessions: 1, messages: 2 });
  assert.equal(Object.keys(first.sourceManifest).length, 2);
  assert.equal(fs.readdirSync(env.storage.cacheDir).length, 2);

  let loaded = loadIndex(env.storage);
  const initialResults = searchIndex(loaded, 'incremental cache', { tool: 'codex', limit: 2 });
  assert.equal(initialResults.length, 1);
  assert.match(initialResults[0].ref, /^[a-f0-9]{12}:\d+$/);
  const shown = showRecord(loaded, initialResults[0].ref);
  assert.equal(shown.messages.length, 2);
  assert.equal(shown.messages.filter((message) => message.target).length, 1);
  assert.equal(showRecord(loaded, initialResults[0].ref, { context: 0 }).messages.length, 1);
  assert.throws(() => showRecord(loaded, 'not-a-ref'), /Invalid result ref/);
  assert.throws(() => showRecord(loaded, 'deadbeefdead:0'), /No indexed result matches/);

  const [sourceHash, sourceEntry] = loaded.sourceByHash.entries().next().value;
  const ambiguousHash = `${sourceHash.slice(0, 12)}${sourceHash.slice(12).replace(/^./, sourceHash[12] === '0' ? '1' : '0')}`;
  loaded.sourceByHash.set(ambiguousHash, sourceEntry);
  assert.throws(() => showRecord(loaded, `${sourceHash.slice(0, 12)}:0`), /ambiguous/);
  loaded.sourceByHash.delete(ambiguousHash);
  assert.equal(listSessions(loaded, { limit: 10 }).length, 2);

  const second = await buildIndex({ roots: env.roots, storage: env.storage });
  assert.deepEqual(second.cacheStats.reused, { claude: 1, codex: 1, cursor: 0 });
  assert.deepEqual(second.cacheStats.parsed, { claude: 0, codex: 0, cursor: 0 });

  fs.appendFileSync(env.claudeFile, '\n{"timestamp":"2026-07-30T08:02:00.000Z","message":{"role":"user","content":"A newly appended marker"}}\n');
  const third = await buildIndex({ roots: env.roots, storage: env.storage });
  assert.equal(third.cacheStats.parsed.claude, 1);
  assert.equal(third.cacheStats.reused.codex, 1);
  assert.equal(third.stats.claude.messages, 3);

  loaded = loadIndex(env.storage);
  assert.equal(searchIndex(loaded, 'newly appended marker', { limit: 2 }).length, 1);

  fs.writeFileSync(path.join(env.storage.cacheDir, 'orphan.json'), '{}');
  fs.unlinkSync(env.codexFile);
  const fourth = await buildIndex({ roots: env.roots, storage: env.storage });
  assert.equal(fourth.cacheStats.removed.codex, 1);
  assert.equal(fourth.stats.codex.messages, 0);
  assert.equal(fs.existsSync(path.join(env.storage.cacheDir, 'orphan.json')), false);
  assert.equal(searchIndex(loadIndex(env.storage), 'incremental cache', { tool: 'codex', limit: 2 }).length, 0);
});

test('v3 remains searchable and the next index run migrates it to v4', async () => {
  const env = createFixtureEnvironment();
  const record = {
    id: 'legacy:1',
    tool: 'codex',
    session: '/tmp/legacy.jsonl',
    project: '/tmp/project',
    role: 'user',
    ts: '2026-07-30T10:00:00.000Z',
    text: 'legacy searchable message',
    excerpt: 'legacy searchable message'
  };
  const miniSearch = new MiniSearch({
    fields: ['text'],
    storeFields: ['tool', 'session', 'role', 'ts', 'project', 'excerpt']
  });
  miniSearch.add(record);
  atomicWriteJson(env.storage.indexFile, {
    version: 3,
    records: [record],
    stats: {
      claude: { sessions: 0, messages: 0 },
      codex: { sessions: 1, messages: 1 },
      cursor: { sessions: 0, messages: 0 }
    },
    miniSearch: miniSearch.toJSON()
  });

  const legacy = loadIndex(env.storage);
  assert.equal(legacy.formatVersion, 3);
  assert.equal(searchIndex(legacy, 'legacy searchable', { limit: 1 }).length, 1);
  assert.throws(() => showRecord(legacy, 'abcd:0'), /requires a v4 index/);

  const migrated = await buildIndex({ roots: env.roots, storage: env.storage });
  assert.equal(migrated.version, 4);
  assert.equal(loadIndex(env.storage).formatVersion, 4);
});

test('doctor reports a healthy and current v4 fixture index', async () => {
  const env = createFixtureEnvironment();
  await buildIndex({ full: true, roots: env.roots, storage: env.storage });
  const result = runDoctor({ roots: env.roots, storage: env.storage });

  assert.equal(result.ok, true);
  assert.equal(result.index.version, 4);
  if (process.platform !== 'win32') {
    assert.equal(result.index.cacheDirectoryMode, '700');
    assert.equal(result.index.insecureCacheFiles, 0);
  }
  assert.deepEqual(
    { new: result.changes.new, modified: result.changes.modified, deleted: result.changes.deleted },
    { new: 0, modified: 0, deleted: 0 }
  );
});

let Database;
try {
  Database = require('better-sqlite3');
} catch {
  Database = null;
}

test('Cursor shards are reparsed on every incremental run', {
  skip: Database ? false : 'better-sqlite3 is unavailable'
}, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sift-v4-cursor-'));
  const cursorRoot = path.join(root, 'Cursor', 'User', 'globalStorage');
  fs.mkdirSync(cursorRoot, { recursive: true });
  const cursorFile = path.join(cursorRoot, 'state.vscdb');
  const db = new Database(cursorFile);
  db.exec('create table cursorDiskKV (key text primary key, value blob)');
  db.prepare('insert into cursorDiskKV (key, value) values (?, ?)').run(
    'bubbleId:composer-1:user-1',
    JSON.stringify({ type: 1, text: 'Cursor refresh marker', createdAt: '2026-07-30T10:00:00.000Z' })
  );
  db.close();

  const roots = emptyRoots(root);
  roots.cursorMacUser = path.join(root, 'Cursor', 'User');
  const storage = createStoragePaths(path.join(root, '.sift'));
  const first = await buildIndex({ full: true, roots, storage });
  const second = await buildIndex({ roots, storage });

  assert.equal(first.stats.cursor.messages, 1);
  assert.equal(second.cacheStats.parsed.cursor, 1);
  assert.equal(second.cacheStats.reused.cursor, 0);
});

function createFixtureEnvironment() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sift-v4-test-'));
  const roots = emptyRoots(root);
  const claudeProject = path.join(roots.claude, 'sample-project');
  fs.mkdirSync(claudeProject, { recursive: true });
  fs.mkdirSync(roots.codexSessions, { recursive: true });
  const claudeFile = path.join(claudeProject, 'session.jsonl');
  const codexFile = path.join(roots.codexSessions, 'session.jsonl');
  fs.copyFileSync(path.join(fixtureDir, 'claude.jsonl'), claudeFile);
  fs.copyFileSync(path.join(fixtureDir, 'codex.jsonl'), codexFile);
  return {
    root,
    roots,
    storage: createStoragePaths(path.join(root, '.sift')),
    claudeFile,
    codexFile
  };
}

function emptyRoots(root) {
  return {
    claude: path.join(root, 'claude'),
    codexSessions: path.join(root, 'codex-sessions'),
    codexArchived: path.join(root, 'codex-archived'),
    cursorMacUser: path.join(root, 'cursor-mac'),
    cursorLinuxUser: path.join(root, 'cursor-linux'),
    cursorWindowsUser: null
  };
}
