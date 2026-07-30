#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { buildIndex, loadIndex } from '../src/index.js';
import { indexFile } from '../src/paths.js';
import { formatResult, formatSession, listSessions, searchIndex } from '../src/search.js';

const usage = `sift - local search for Claude Code, Codex, and Cursor session logs

Usage:
  sift index [--full]
  sift search "<query>" [--tool claude|codex|cursor] [--limit N]
  sift "<query>" [--tool claude|codex|cursor] [--limit N]
  sift list [--tool claude|codex|cursor] [--limit N]

Privacy:
  Reads local logs/databases only. Writes only ${indexFile}. No network, no telemetry.`;

try {
  main();
} catch (error) {
  if (error.message !== '__sift_exit__') throw error;
}

function main() {
  const raw = process.argv.slice(2);
  if (raw.length === 0 || raw.includes('--help') || raw.includes('-h')) {
    console.log(usage);
    return;
  }

  const command = raw[0];
  if (command === 'index') {
    runIndex(raw.slice(1));
  } else if (command === 'search') {
    runSearch(raw.slice(1));
  } else if (command === 'list') {
    runList(raw.slice(1));
  } else {
    runSearch(raw);
  }
}

function runIndex(args) {
  const { full } = parseIndexCli(args);
  let result;
  try {
    result = buildIndex({ full });
  } catch (error) {
    fail(`Could not build the index: ${error.message}`);
  }

  const totalMessages = result.stats.claude.messages + result.stats.codex.messages + result.stats.cursor.messages;

  if (totalMessages === 0) {
    console.log('No Claude Code, Codex, or Cursor messages found.');
    console.log('Checked ~/.claude/projects, ~/.codex/sessions, ~/.codex/archived_sessions, and Cursor user storage.');
    return;
  }

  console.log('Indexed local logs:');
  printToolSummary('claude', result.stats.claude);
  printToolSummary('codex', result.stats.codex);
  printToolSummary('cursor', result.stats.cursor);
  printFileSummary(result.cacheStats);
  if (result.malformedCount) {
    console.log(`Skipped ${result.malformedCount} malformed JSONL line(s).`);
  }
  for (const warning of result.warnings ?? []) {
    console.warn(`Warning: ${warning}`);
  }
  console.log(`Saved index to ${result.indexFile}`);
}

function parseIndexCli(args) {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: false,
      options: {
        full: { type: 'boolean' },
        rebuild: { type: 'boolean' }
      }
    });
  } catch (error) {
    fail(error.message);
  }

  return { full: Boolean(parsed.values.full || parsed.values.rebuild) };
}

function runSearch(args) {
  const { values, positionals } = parseCli(args);
  const query = positionals.join(' ').trim();
  if (!query) fail('Please provide a search query. Try: sift search "graphify"');

  const loaded = loadIndexOrFail();
  if (!loaded) fail(`No index found yet. Run: sift index`);

  const results = searchIndex(loaded, query, {
    tool: values.tool,
    limit: values.limit
  });

  if (!results.length) {
    console.log(`No results for "${query}".`);
    return;
  }

  for (const result of results) {
    console.log(formatResult(result, query));
    console.log('');
  }
}

function runList(args) {
  const { values } = parseCli(args);
  const loaded = loadIndexOrFail();
  if (!loaded) fail(`No index found yet. Run: sift index`);

  const sessions = listSessions(loaded, {
    tool: values.tool,
    limit: values.limit
  });

  if (!sessions.length) {
    console.log('No sessions found for that filter.');
    return;
  }

  for (const session of sessions) {
    console.log(formatSession(session));
    console.log('');
  }
}

function loadIndexOrFail() {
  try {
    return loadIndex();
  } catch (error) {
    fail(error.message);
  }
}

function parseCli(args) {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      options: {
        tool: { type: 'string' },
        limit: { type: 'string', short: 'n' }
      }
    });
  } catch (error) {
    fail(error.message);
  }

  if (parsed.values.tool && !['claude', 'codex', 'cursor'].includes(parsed.values.tool)) {
    fail('--tool must be claude, codex, or cursor');
  }

  const limit = parsed.values.limit === undefined ? 10 : Number.parseInt(parsed.values.limit, 10);
  if (!Number.isInteger(limit) || limit < 1) fail('--limit must be a positive integer');

  return {
    values: { ...parsed.values, limit },
    positionals: parsed.positionals
  };
}

function printToolSummary(tool, stats) {
  console.log(`  ${tool}: ${stats.sessions} sessions, ${stats.messages} messages`);
}

function printFileSummary(cacheStats) {
  if (!cacheStats) return;
  const reused = totalCacheCount(cacheStats.reused);
  const parsed = totalCacheCount(cacheStats.parsed);
  console.log(`  files: ${reused} reused, ${parsed} parsed (${formatCacheCounts(cacheStats.parsed)} parsed)`);
}

function totalCacheCount(counts = {}) {
  return Object.values(counts).reduce((sum, count) => sum + count, 0);
}

function formatCacheCounts(counts = {}) {
  return ['claude', 'codex', 'cursor'].map((tool) => `${tool} ${counts[tool] ?? 0}`).join(', ');
}

function fail(message) {
  console.error(message);
  process.exitCode = 1;
  throw new Error('__sift_exit__');
}
