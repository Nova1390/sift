import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseClaudeFile } from '../src/parse-claude.js';
import { parseCodexFile } from '../src/parse-codex.js';
import { parseCursorFile } from '../src/parse-cursor.js';

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const require = createRequire(import.meta.url);

test('Claude parser extracts strings and text blocks while skipping malformed lines', () => {
  const file = path.join(fixtureDir, 'claude.jsonl');
  const before = fs.statSync(file).mtimeMs;
  const malformed = [];
  const records = parseClaudeFile(file, malformed);

  assert.deepEqual(records.map(({ role, text }) => ({ role, text })), [
    { role: 'user', text: 'Find the local cache bug' },
    { role: 'assistant', text: 'The cache key is stale.' }
  ]);
  assert.equal(records[0].ts, '2026-07-30T08:00:00.000Z');
  assert.equal(malformed.length, 1);
  assert.equal(fs.statSync(file).mtimeMs, before);
});

test('Codex parser deduplicates message representations and keeps project context', () => {
  const file = path.join(fixtureDir, 'codex.jsonl');
  const before = fs.statSync(file).mtimeMs;
  const malformed = [];
  const records = parseCodexFile(file, malformed);

  assert.deepEqual(records.map(({ role, text }) => ({ role, text })), [
    { role: 'user', text: 'Fix the incremental cache' },
    { role: 'assistant', text: 'The changed file is reindexed.' }
  ]);
  assert.equal(records[0].project, '/tmp/sift-project');
  assert.equal(malformed.length, 1);
  assert.equal(fs.statSync(file).mtimeMs, before);
});

let Database;
try {
  Database = require('better-sqlite3');
} catch {
  Database = null;
}

test('Cursor parser maps numeric bubble roles and leaves the source database unchanged', {
  skip: Database ? false : 'better-sqlite3 is unavailable'
}, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sift-cursor-test-'));
  const file = path.join(dir, 'state.vscdb');
  const db = new Database(file);
  db.exec('create table cursorDiskKV (key text primary key, value blob)');
  const insert = db.prepare('insert into cursorDiskKV (key, value) values (?, ?)');
  insert.run('bubbleId:composer-1:user-1', JSON.stringify({
    type: 1,
    text: 'Can you inspect this cache?',
    createdAt: '2026-07-30T10:00:00.000Z'
  }));
  insert.run('bubbleId:composer-1:assistant-1', JSON.stringify({
    type: 2,
    text: 'The cache is local and read-only.',
    createdAt: '2026-07-30T10:01:00.000Z'
  }));
  db.close();

  const before = fs.statSync(file);
  const warnings = [];
  const records = parseCursorFile(file, warnings);
  const after = fs.statSync(file);

  assert.deepEqual(records.map(({ role, text }) => ({ role, text })), [
    { role: 'user', text: 'Can you inspect this cache?' },
    { role: 'assistant', text: 'The cache is local and read-only.' }
  ]);
  assert.equal(records[0].session, `${file}#composer-1`);
  assert.equal(records[0].ts, '2026-07-30T10:00:00.000Z');
  assert.deepEqual(warnings, []);
  assert.equal(after.mtimeMs, before.mtimeMs);
  assert.equal(after.size, before.size);
});
