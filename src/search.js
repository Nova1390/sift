import { dateTimePart } from './text.js';
import {
  indexPayloadVersion,
  loadRecord,
  loadSourceRecords,
  resolveRecordRef,
  resultRef
} from './index.js';

const ansi = {
  bold: '\u001b[1m',
  cyan: '\u001b[36m',
  dim: '\u001b[2m',
  reset: '\u001b[0m',
  yellow: '\u001b[33m'
};

export function searchIndex(loaded, query, { tool, limit = 10 } = {}) {
  let results = loaded.miniSearch.search(query, {
    prefix: true,
    fuzzy: 0.2,
    combineWith: 'AND',
    boost: { text: 2 }
  });
  if (!results.length) {
    results = loaded.miniSearch.search(query, {
      prefix: true,
      fuzzy: 0.2,
      boost: { text: 2 }
    });
  }

  if (loaded.formatVersion === indexPayloadVersion) {
    return results
      .filter((result) => !tool || result.tool === tool)
      .slice(0, limit)
      .map((result) => ({
        ...result,
        ref: resultRef(loaded, result.id),
        record: loadRecord(loaded, result.id)
      }))
      .filter((result) => result.record);
  }

  const byId = new Map(loaded.records.map((record) => [record.id, record]));
  return results
    .map((result) => ({ ...result, ref: null, record: byId.get(result.id) }))
    .filter((result) => result.record && (!tool || result.record.tool === tool))
    .slice(0, limit);
}

export function listSessions(loaded, { tool, limit = 20 } = {}) {
  if (loaded.formatVersion === indexPayloadVersion) {
    return loaded.sessions
      .filter((session) => !tool || session.tool === tool)
      .slice(0, limit);
  }

  const sessions = new Map();
  for (const record of loaded.records) {
    if (tool && record.tool !== tool) continue;
    const existing = sessions.get(record.session);
    if (!existing || compareTs(record.ts, existing.ts) > 0) {
      sessions.set(record.session, {
        tool: record.tool,
        session: record.session,
        project: record.project,
        ts: record.ts,
        messages: (existing?.messages ?? 0) + 1
      });
    } else if (existing) {
      existing.messages += 1;
    }
  }

  return [...sessions.values()]
    .sort((a, b) => compareTs(b.ts, a.ts))
    .slice(0, limit);
}

export function formatResult(result, query, useColor = process.stdout.isTTY) {
  const record = result.record;
  const header = `[${record.tool} · ${dateTimePart(record.ts)}]`;
  const snippet = makeSnippet(record.text, query, useColor);
  const detail = result.ref ? `${record.session} · ref ${result.ref}` : record.session;
  const session = useColor ? `${ansi.dim}${detail}${ansi.reset}` : detail;
  return `${color(header, ansi.cyan, useColor)} ${snippet}\n${session}`;
}

export function formatSession(session, useColor = process.stdout.isTTY) {
  const header = `[${session.tool} · ${dateTimePart(session.ts)} · ${session.messages} messages]`;
  const project = session.project ? ` ${session.project}` : '';
  const detail = useColor ? `${ansi.dim}${session.session}${ansi.reset}` : session.session;
  return `${color(header, ansi.cyan, useColor)}${project}\n${detail}`;
}

export function showRecord(loaded, ref, { context = 2 } = {}) {
  const resolved = resolveRecordRef(loaded, ref);
  const records = loadSourceRecords(loaded, resolved.entry)
    .filter((record) => record.session === resolved.record.session);
  const targetIndex = records.findIndex((record) => record.id === resolved.id);
  if (targetIndex < 0) throw new Error(`No indexed result matches ref ${ref}`);

  const start = Math.max(0, targetIndex - context);
  const end = Math.min(records.length, targetIndex + context + 1);
  return {
    ref: resultRef(loaded, resolved.id),
    tool: resolved.record.tool,
    session: resolved.record.session,
    project: resolved.record.project,
    messages: records.slice(start, end).map((record) => ({
      ref: resultRef(loaded, record.id),
      tool: record.tool,
      session: record.session,
      project: record.project,
      role: record.role,
      ts: record.ts,
      text: record.text,
      target: record.id === resolved.id
    }))
  };
}

export function formatShow(result, useColor = process.stdout.isTTY) {
  return result.messages.map((message) => {
    const marker = message.target ? '>' : ' ';
    const header = `[${message.role} · ${dateTimePart(message.ts)} · ref ${message.ref}]`;
    return `${marker} ${color(header, ansi.cyan, useColor)} ${message.text}`;
  }).join('\n\n');
}

export function makeSnippet(text, query, useColor = false) {
  const terms = queryTerms(query);
  const lower = text.toLowerCase();
  const firstHit = terms
    .map((term) => lower.indexOf(term.toLowerCase()))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0] ?? 0;

  const start = Math.max(0, firstHit - 80);
  const end = Math.min(text.length, firstHit + 220);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < text.length ? '...' : '';
  const snippet = `${prefix}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${suffix}`;

  if (!useColor || !terms.length) return snippet;
  const pattern = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'gi');
  return snippet.replace(pattern, `${ansi.yellow}${ansi.bold}$1${ansi.reset}`);
}

function queryTerms(query) {
  return [...new Set(query.match(/[\p{L}\p{N}_]+/gu) ?? [])].filter((term) => term.length > 1);
}

function color(value, code, useColor) {
  return useColor ? `${code}${value}${ansi.reset}` : value;
}

function compareTs(a, b) {
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;
  return a.localeCompare(b);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
