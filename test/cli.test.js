import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..');
const bin = path.join(repoRoot, 'bin', 'sift.js');

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

function runCli(home, args) {
  const result = spawnSync(process.execPath, [bin, ...args], {
    cwd: repoRoot,
    env: { ...process.env, HOME: home, APPDATA: '' },
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
