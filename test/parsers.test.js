import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseClaudeFile } from '../src/parse-claude.js';
import { parseCodexFile } from '../src/parse-codex.js';
import { parseCursorFile } from '../src/parse-cursor.js';
import { inspectOpenCodeFile, parseOpenCodeFile } from '../src/parse-opencode.js';

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

test('OpenCode parser extracts visible text parts in read-only mode', {
  skip: Database ? false : 'better-sqlite3 is unavailable'
}, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sift-opencode-test-'));
  const file = path.join(dir, 'opencode.db');
  const db = new Database(file);
  createOpenCodeSchema(db);
  insertOpenCodeSession(db, 'session-1', '/tmp/opencode-project');
  insertOpenCodeMessage(db, 'message-1', 'session-1', 1785744000000, {
    role: 'user',
    time: { created: 1785744001000 }
  });
  insertOpenCodePart(db, 'part-1', 'message-1', 'session-1', { type: 'text', text: 'First visible block' });
  insertOpenCodePart(db, 'part-2', 'message-1', 'session-1', { type: 'reasoning', text: 'Private reasoning' });
  insertOpenCodePart(db, 'part-3', 'message-1', 'session-1', { type: 'text', text: 'Second visible block' });
  insertOpenCodePart(db, 'part-4', 'message-1', 'session-1', { type: 'text', text: 'Synthetic text', synthetic: true });
  insertOpenCodePart(db, 'part-5', 'message-1', 'session-1', { type: 'tool', state: { output: 'Tool output' } });
  insertOpenCodeMessage(db, 'message-2', 'session-1', 1785744060000, { role: 'assistant' });
  insertOpenCodePart(db, 'part-6', 'message-2', 'session-1', { type: 'text', text: 'Ignored text', ignored: true });
  insertOpenCodePart(db, 'part-7', 'message-2', 'session-1', { type: 'text', text: 'Assistant answer' });
  insertOpenCodeMessage(db, 'message-empty', 'session-1', 1785744120000, { role: 'assistant' });
  db.close();

  const before = sourceFingerprint(file);
  const warnings = [];
  const records = parseOpenCodeFile(file, warnings);

  assert.deepEqual(records.map(({ role, text }) => ({ role, text })), [
    { role: 'user', text: 'First visible block\nSecond visible block' },
    { role: 'assistant', text: 'Assistant answer' }
  ]);
  assert.equal(records[0].session, `${file}#session-1`);
  assert.equal(records[0].project, '/tmp/opencode-project');
  assert.equal(records[0].ts, '2026-08-03T08:00:01.000Z');
  assert.equal(records[1].ts, '2026-08-03T08:01:00.000Z');
  assert.deepEqual(warnings, []);
  assert.deepEqual(sourceFingerprint(file), before);
  assert.deepEqual(inspectOpenCodeFile(file), { ok: true, error: null });
});

test('OpenCode parser isolates malformed data, missing schemas, and unavailable SQLite', {
  skip: Database ? false : 'better-sqlite3 is unavailable'
}, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sift-opencode-errors-'));
  const file = path.join(dir, 'opencode.db');
  const db = new Database(file);
  createOpenCodeSchema(db);
  insertOpenCodeSession(db, 'session-1', '/tmp/opencode-project');
  db.prepare('insert into message (id, session_id, time_created, data) values (?, ?, ?, ?)')
    .run('broken-message', 'session-1', 1785744000000, '{broken');
  insertOpenCodePart(db, 'part-1', 'broken-message', 'session-1', { type: 'text', text: 'Must be skipped' });
  insertOpenCodeMessage(db, 'valid-message', 'session-1', 1785744060000, { role: 'assistant' });
  db.prepare('insert into part (id, message_id, session_id, data) values (?, ?, ?, ?)')
    .run('part-2', 'valid-message', 'session-1', '{broken');
  insertOpenCodePart(db, 'part-3', 'valid-message', 'session-1', { type: 'text', text: 'Still indexed' });
  db.close();

  const warnings = [];
  const records = parseOpenCodeFile(file, warnings);
  assert.deepEqual(records.map((record) => record.text), ['Still indexed']);
  assert.match(warnings[0], /2 malformed message\/part JSON value/);

  const wrongSchema = path.join(dir, 'wrong.db');
  const wrongDb = new Database(wrongSchema);
  wrongDb.exec('create table unrelated (id text)');
  wrongDb.close();
  const schemaWarnings = [];
  assert.deepEqual(parseOpenCodeFile(wrongSchema, schemaWarnings), []);
  assert.match(schemaWarnings[0], /required table session was not found/);

  const loadWarnings = [];
  assert.deepEqual(parseOpenCodeFile(file, loadWarnings, {
    loadDatabase: () => { throw new Error('native module unavailable'); }
  }), []);
  assert.match(loadWarnings[0], /better-sqlite3 could not load/);
});

test('OpenCode parser reads committed messages while the source WAL is active', {
  skip: Database ? false : 'better-sqlite3 is unavailable'
}, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sift-opencode-wal-'));
  const file = path.join(dir, 'opencode.db');
  const writer = new Database(file);
  writer.pragma('journal_mode = WAL');
  createOpenCodeSchema(writer);
  insertOpenCodeSession(writer, 'session-wal', '/tmp/opencode-wal');
  insertOpenCodeMessage(writer, 'message-wal', 'session-wal', 1785744000000, { role: 'user' });
  insertOpenCodePart(writer, 'part-wal', 'message-wal', 'session-wal', { type: 'text', text: 'Committed WAL marker' });

  const records = parseOpenCodeFile(file);
  assert.deepEqual(records.map((record) => record.text), ['Committed WAL marker']);
  writer.close();
});

function createOpenCodeSchema(db) {
  db.exec(`
    create table session (id text primary key, directory text);
    create table message (id text primary key, session_id text, time_created integer, data text);
    create table part (id text primary key, message_id text, session_id text, data text);
  `);
}

function insertOpenCodeSession(db, id, directory) {
  db.prepare('insert into session (id, directory) values (?, ?)').run(id, directory);
}

function insertOpenCodeMessage(db, id, sessionId, timeCreated, data) {
  db.prepare('insert into message (id, session_id, time_created, data) values (?, ?, ?, ?)')
    .run(id, sessionId, timeCreated, JSON.stringify(data));
}

function insertOpenCodePart(db, id, messageId, sessionId, data) {
  db.prepare('insert into part (id, message_id, session_id, data) values (?, ?, ?, ?)')
    .run(id, messageId, sessionId, JSON.stringify(data));
}

function sourceFingerprint(file) {
  const stat = fs.statSync(file);
  return {
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    sha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  };
}
