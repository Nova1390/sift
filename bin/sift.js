#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { formatDoctor, runDoctor } from '../src/doctor.js';
import { buildIndex, loadIndex } from '../src/index.js';
import { indexFile } from '../src/paths.js';
import {
  formatResult,
  formatSession,
  formatShow,
  listSessions,
  makeSnippet,
  searchIndex,
  showRecord
} from '../src/search.js';

const tools = ['claude', 'codex', 'cursor', 'opencode'];

const usage = `sift - local search for Claude Code, Codex, Cursor, and OpenCode session logs

Usage:
  sift index [--full] [--json]
  sift search "<query>" [--tool claude|codex|cursor|opencode] [--limit N] [--json]
  sift "<query>" [--tool claude|codex|cursor|opencode] [--limit N] [--json]
  sift list [--tool claude|codex|cursor|opencode] [--limit N] [--json]
  sift show <ref> [--context N] [--json]
  sift doctor [--json]

Privacy:
  Reads local logs/databases only. Writes only under ${indexFile.replace(/\/index\.json$/, '')}. No network, no telemetry.`;

main().catch((error) => {
  if (error.message === '__sift_exit__') return;
  console.error(error.message);
  process.exitCode = 1;
});

async function main() {
  const raw = process.argv.slice(2);
  if (raw.length === 0 || raw.includes('--help') || raw.includes('-h')) {
    console.log(usage);
    return;
  }

  const command = raw[0];
  if (command === 'index') {
    await runIndex(raw.slice(1));
  } else if (command === 'search') {
    runSearch(raw.slice(1));
  } else if (command === 'list') {
    runList(raw.slice(1));
  } else if (command === 'show') {
    runShow(raw.slice(1));
  } else if (command === 'doctor') {
    runDoctorCommand(raw.slice(1));
  } else {
    runSearch(raw);
  }
}

async function runIndex(args) {
  const { full, json } = parseIndexCli(args);
  let result;
  try {
    result = await buildIndex({ full });
  } catch (error) {
    fail(`Could not build the index: ${error.message}`, json);
  }

  const totalMessages = Object.values(result.stats)
    .reduce((sum, stats) => sum + stats.messages, 0);

  if (json) {
    printJson({
      ok: totalMessages > 0,
      version: result.version,
      generatedAt: result.generatedAt,
      indexFile: result.indexFile,
      stats: result.stats,
      malformedCount: result.malformedCount,
      cacheStats: result.cacheStats,
      warnings: result.warnings
    });
    return;
  }

  if (totalMessages === 0) {
    console.log('No Claude Code, Codex, Cursor, or OpenCode messages found.');
    console.log('Checked ~/.claude/projects, ~/.codex/sessions, ~/.codex/archived_sessions, Cursor user storage, and OpenCode data storage.');
    return;
  }

  console.log('Indexed local logs:');
  printToolSummary('claude', result.stats.claude);
  printToolSummary('codex', result.stats.codex);
  printToolSummary('cursor', result.stats.cursor);
  printToolSummary('opencode', result.stats.opencode);
  printFileSummary(result.cacheStats);
  if (result.malformedCount) {
    console.log(`Skipped ${result.malformedCount} malformed JSONL line(s).`);
  }
  for (const warning of result.warnings ?? []) {
    console.warn(`Warning: ${warning}`);
  }
  console.log(`Saved index to ${result.indexFile}`);
}

function runSearch(args) {
  const { values, positionals } = parseCli(args);
  const query = positionals.join(' ').trim();
  if (!query) fail('Please provide a search query. Try: sift search "graphify"', values.json);

  const loaded = loadIndexOrFail(values.json);
  if (!loaded) fail('No index found yet. Run: sift index', values.json);

  let results;
  try {
    results = searchIndex(loaded, query, {
      tool: values.tool,
      limit: values.limit
    });
  } catch (error) {
    fail(error.message, values.json);
  }

  if (values.json) {
    printJson({
      ok: true,
      query,
      count: results.length,
      results: results.map((result) => ({
        ref: result.ref,
        score: result.score,
        tool: result.record.tool,
        session: result.record.session,
        project: result.record.project,
        role: result.record.role,
        ts: result.record.ts,
        snippet: makeSnippet(result.record.text, query, false)
      }))
    });
    return;
  }

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
  const loaded = loadIndexOrFail(values.json);
  if (!loaded) fail('No index found yet. Run: sift index', values.json);

  const sessions = listSessions(loaded, {
    tool: values.tool,
    limit: values.limit
  });

  if (values.json) {
    printJson({
      ok: true,
      count: sessions.length,
      sessions
    });
    return;
  }

  if (!sessions.length) {
    console.log('No sessions found for that filter.');
    return;
  }

  for (const session of sessions) {
    console.log(formatSession(session));
    console.log('');
  }
}

function runShow(args) {
  const { values, positionals } = parseShowCli(args);
  if (positionals.length !== 1) {
    fail('Provide exactly one result ref. Try: sift show a13f09c2e4ab:17', values.json);
  }

  const loaded = loadIndexOrFail(values.json);
  if (!loaded) fail('No index found yet. Run: sift index', values.json);

  let result;
  try {
    result = showRecord(loaded, positionals[0], { context: values.context });
  } catch (error) {
    fail(error.message, values.json);
  }

  if (values.json) {
    printJson({ ok: true, ...result });
  } else {
    console.log(formatShow(result));
  }
}

function runDoctorCommand(args) {
  const { values } = parseDoctorCli(args);
  const result = runDoctor();
  if (values.json) {
    printJson(result);
  } else {
    console.log(formatDoctor(result));
  }
  if (!result.ok) process.exitCode = 1;
}

function parseIndexCli(args) {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: false,
      options: {
        full: { type: 'boolean' },
        rebuild: { type: 'boolean' },
        json: { type: 'boolean' }
      }
    });
  } catch (error) {
    fail(error.message, args.includes('--json'));
  }

  return {
    full: Boolean(parsed.values.full || parsed.values.rebuild),
    json: Boolean(parsed.values.json)
  };
}

function parseCli(args) {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      options: {
        tool: { type: 'string' },
        limit: { type: 'string', short: 'n' },
        json: { type: 'boolean' }
      }
    });
  } catch (error) {
    fail(error.message, args.includes('--json'));
  }

  validateTool(parsed.values.tool, parsed.values.json);
  const limit = parsePositiveInteger(parsed.values.limit, 10, '--limit', parsed.values.json);
  return {
    values: { ...parsed.values, limit, json: Boolean(parsed.values.json) },
    positionals: parsed.positionals
  };
}

function parseShowCli(args) {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      options: {
        context: { type: 'string' },
        json: { type: 'boolean' }
      }
    });
  } catch (error) {
    fail(error.message, args.includes('--json'));
  }

  return {
    values: {
      context: parsePositiveInteger(parsed.values.context, 2, '--context', parsed.values.json, true),
      json: Boolean(parsed.values.json)
    },
    positionals: parsed.positionals
  };
}

function parseDoctorCli(args) {
  try {
    return parseArgs({
      args,
      allowPositionals: false,
      options: {
        json: { type: 'boolean' }
      }
    });
  } catch (error) {
    fail(error.message, args.includes('--json'));
  }
}

function validateTool(tool, json) {
  if (tool && !tools.includes(tool)) {
    fail(`--tool must be ${tools.slice(0, -1).join(', ')}, or ${tools.at(-1)}`, json);
  }
}

function parsePositiveInteger(value, fallback, name, json, allowZero = false) {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  const minimum = allowZero ? 0 : 1;
  if (!Number.isInteger(parsed) || parsed < minimum) {
    fail(`${name} must be ${allowZero ? 'a non-negative' : 'a positive'} integer`, json);
  }
  return parsed;
}

function loadIndexOrFail(json) {
  try {
    return loadIndex();
  } catch (error) {
    fail(error.message, json);
  }
}

function printToolSummary(tool, stats) {
  console.log(`  ${tool}: ${stats.sessions} sessions, ${stats.messages} messages`);
}

function printFileSummary(cacheStats) {
  if (!cacheStats) return;
  const reused = totalCacheCount(cacheStats.reused);
  const parsed = totalCacheCount(cacheStats.parsed);
  const removed = totalCacheCount(cacheStats.removed);
  console.log(`  files: ${reused} reused, ${parsed} parsed, ${removed} removed (${formatCacheCounts(cacheStats.parsed)} parsed)`);
}

function totalCacheCount(counts = {}) {
  return Object.values(counts).reduce((sum, count) => sum + count, 0);
}

function formatCacheCounts(counts = {}) {
  return tools.map((tool) => `${tool} ${counts[tool] ?? 0}`).join(', ');
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function fail(message, json = false) {
  if (json) {
    printJson({ ok: false, error: message });
  } else {
    console.error(message);
  }
  process.exitCode = 1;
  throw new Error('__sift_exit__');
}
