import { datePart } from './text.js';

const ansi = {
  bold: '\u001b[1m',
  cyan: '\u001b[36m',
  dim: '\u001b[2m',
  reset: '\u001b[0m',
  yellow: '\u001b[33m'
};

export function searchIndex(loaded, query, { tool, limit = 10 } = {}) {
  const byId = new Map(loaded.records.map((record) => [record.id, record]));
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

  return results
    .map((result) => ({ ...result, record: byId.get(result.id) }))
    .filter((result) => result.record && (!tool || result.record.tool === tool))
    .slice(0, limit);
}

export function listSessions(loaded, { tool, limit = 20 } = {}) {
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
  const header = `[${record.tool} · ${datePart(record.ts)}]`;
  const snippet = makeSnippet(record.text, query, useColor);
  const session = useColor ? `${ansi.dim}${record.session}${ansi.reset}` : record.session;
  return `${color(header, ansi.cyan, useColor)} ${snippet}\n${session}`;
}

export function formatSession(session, useColor = process.stdout.isTTY) {
  const header = `[${session.tool} · ${datePart(session.ts)} · ${session.messages} messages]`;
  const project = session.project ? ` ${session.project}` : '';
  const detail = useColor ? `${ansi.dim}${session.session}${ansi.reset}` : session.session;
  return `${color(header, ansi.cyan, useColor)}${project}\n${detail}`;
}

function makeSnippet(text, query, useColor) {
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
