import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..');
const bin = path.join(repoRoot, 'bin', 'sift.js');
const require = createRequire(import.meta.url);
let Database;
try {
  Database = require('better-sqlite3');
} catch {
  Database = null;
}

test('CLI exposes JSON index, search, show, list, and doctor workflows without ANSI', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sift-cli-test-'));
  const project = path.join(home, '.claude', 'projects', 'sample');
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(path.join(project, 'session.jsonl'), [
    JSON.stringify({
      timestamp: '2026-07-30T08:00:00.000Z',
      message: { role: 'user', content: 'Where is the cache marker?' }
    }),
    JSON.stringify({
      timestamp: '2026-07-30T08:01:00.000Z',
      message: { role: 'assistant', content: 'The cache marker is local.' }
    }),
    JSON.stringify({
      timestamp: '2026-07-30T08:02:00.000Z',
      message: { role: 'user', content: 'Keep it read only.' }
    })
  ].join('\n'));

  const indexed = runCli(home, ['index', '--json']);
  assert.equal(indexed.status, 0);
  assert.equal(indexed.json.version, 4);
  assert.equal(indexed.json.stats.claude.messages, 3);

  const searched = runCli(home, ['search', 'cache marker', '--json']);
  assert.equal(searched.status, 0);
  assert.equal(searched.json.count, 2);
  assert.match(searched.json.results[0].ref, /^[a-f0-9]{12}:\d+$/);
  assert.doesNotMatch(searched.stdout, /\u001b/);

  const shown = runCli(home, ['show', searched.json.results[0].ref, '--context', '1', '--json']);
  assert.equal(shown.status, 0);
  assert.equal(shown.json.messages.filter((message) => message.target).length, 1);
  assert.ok(shown.json.messages.length >= 2);

  const listed = runCli(home, ['list', '--json']);
  assert.equal(listed.status, 0);
  assert.equal(listed.json.count, 1);

  const doctor = runCli(home, ['doctor', '--json']);
  assert.equal(doctor.status, 0);
  assert.equal(doctor.json.ok, true);
  assert.equal(doctor.json.index.version, 4);
});

test('CLI indexes, searches, shows, lists, and diagnoses OpenCode sessions', {
  skip: Database ? false : 'better-sqlite3 is unavailable'
}, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sift-cli-opencode-'));
  const dataHome = path.join(home, '.local', 'share');
  const databaseFile = path.join(dataHome, 'opencode', 'opencode.db');
  fs.mkdirSync(path.dirname(databaseFile), { recursive: true });
  const db = new Database(databaseFile);
  db.exec(`
    create table session (id text primary key, directory text);
    create table message (id text primary key, session_id text, time_created integer, data text);
    create table part (id text primary key, message_id text, session_id text, data text);
    insert into session (id, directory) values ('session-1', '/tmp/opencode-project');
  `);
  const insertMessage = db.prepare('insert into message (id, session_id, time_created, data) values (?, ?, ?, ?)');
  const insertPart = db.prepare('insert into part (id, message_id, session_id, data) values (?, ?, ?, ?)');
  insertMessage.run('message-1', 'session-1', 1785744000000, JSON.stringify({ role: 'user' }));
  insertPart.run('part-1', 'message-1', 'session-1', JSON.stringify({ type: 'text', text: 'OpenCode local marker question' }));
  insertMessage.run('message-2', 'session-1', 1785744060000, JSON.stringify({ role: 'assistant' }));
  insertPart.run('part-2', 'message-2', 'session-1', JSON.stringify({ type: 'text', text: 'OpenCode local marker answer' }));
  db.close();

  const indexed = runCli(home, ['index', '--json']);
  assert.equal(indexed.status, 0);
  assert.deepEqual(indexed.json.stats.opencode, { sessions: 1, messages: 2 });

  const searched = runCli(home, ['search', 'local marker', '--tool', 'opencode', '--json']);
  assert.equal(searched.status, 0);
  assert.equal(searched.json.count, 2);
  assert.ok(searched.json.results.every((result) => result.tool === 'opencode'));
  assert.doesNotMatch(searched.stdout, /\u001b/);

  const shown = runCli(home, ['show', searched.json.results[0].ref, '--json']);
  assert.equal(shown.status, 0);
  assert.equal(shown.json.session, `${databaseFile}#session-1`);
  assert.equal(shown.json.messages.length, 2);

  const listed = runCli(home, ['list', '--tool', 'opencode', '--json']);
  assert.equal(listed.status, 0);
  assert.equal(listed.json.count, 1);
  assert.equal(listed.json.sessions[0].tool, 'opencode');

  const doctor = runCli(home, ['doctor', '--json']);
  assert.equal(doctor.status, 0);
  assert.equal(doctor.json.sources.opencode.databases, 1);
  assert.equal(doctor.json.sources.opencode.schemaReadable, true);
});

function runCli(home, args) {
  const result = spawnSync(process.execPath, [bin, ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: home,
      APPDATA: '',
      LOCALAPPDATA: '',
      XDG_DATA_HOME: path.join(home, '.local', 'share')
    },
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024
  });
  let json;
  try {
    json = JSON.parse(result.stdout);
  } catch {
    assert.fail(`Expected JSON output, got:\n${result.stdout}\n${result.stderr}`);
  }
  return { ...result, json };
}
