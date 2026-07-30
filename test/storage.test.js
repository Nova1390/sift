import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { calculateStats, loadIndex } from '../src/index.js';
import { atomicWriteJson, ensurePrivateDir } from '../src/storage.js';

test('private storage uses restrictive POSIX permissions and atomic replacement', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sift-storage-test-'));
  const dir = path.join(root, '.sift');
  const file = path.join(dir, 'index.json');

  ensurePrivateDir(dir);
  atomicWriteJson(file, { version: 1 });
  atomicWriteJson(file, { version: 2 });

  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { version: 2 });
  assert.deepEqual(fs.readdirSync(dir), ['index.json']);

  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  }
});

test('loadIndex reports corrupt and incompatible payloads with rebuild guidance', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sift-load-test-'));
  const file = path.join(root, 'index.json');

  fs.writeFileSync(file, '{broken', 'utf8');
  assert.throws(() => loadIndex(file), /sift index --full/);

  fs.writeFileSync(file, JSON.stringify({ version: 999 }), 'utf8');
  assert.throws(() => loadIndex(file), /sift index --full/);
});

test('stats count unique normalized sessions rather than source files', () => {
  const stats = calculateStats({
    '/tmp/cursor.db': {
      tool: 'cursor',
      records: [
        { session: 'cursor#a' },
        { session: 'cursor#a' },
        { session: 'cursor#b' }
      ]
    },
    '/tmp/codex.jsonl': {
      tool: 'codex',
      records: [
        { session: 'codex#one' },
        { session: 'codex#one' }
      ]
    }
  });

  assert.deepEqual(stats.cursor, { sessions: 2, messages: 3 });
  assert.deepEqual(stats.codex, { sessions: 1, messages: 2 });
});

test('Cursor native integration is declared optional', () => {
  const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(packageJson.dependencies['better-sqlite3'], undefined);
  assert.equal(packageJson.optionalDependencies['better-sqlite3'], '^12.11.1');
});
