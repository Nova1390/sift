import path from 'node:path';
import { createRequire } from 'node:module';
import { compactText, extractTextContent, toIso } from './text.js';

const require = createRequire(import.meta.url);
const keyPattern = /aichat|composer|chatdata|bubble|conversation|chat/i;

export function parseCursorFile(file, warnings = []) {
  let Database;
  try {
    Database = require('better-sqlite3');
  } catch (error) {
    warnings.push(`Cursor skipped: better-sqlite3 could not load (${error.message})`);
    return [];
  }

  let db;
  try {
    db = new Database(file, { readonly: true, fileMustExist: true });
    db.pragma('query_only = ON');
  } catch (error) {
    warnings.push(`Cursor skipped ${file}: ${error.message}`);
    return [];
  }

  try {
    return parseOpenDatabase(db, file, warnings);
  } catch (error) {
    warnings.push(`Cursor skipped ${file}: ${error.message}`);
    return [];
  } finally {
    try {
      db.close();
    } catch {
      // Nothing useful to do; the database was opened read-only.
    }
  }
}

function parseOpenDatabase(db, file, warnings) {
  const records = [];
  const tables = safeAll(db, "select name from sqlite_master where type = 'table' order by name", [], warnings, file);
  const project = inferCursorProject(file);

  for (const { name: table } of tables) {
    const columns = safeAll(db, `pragma table_info(${quoteIdentifier(table)})`, [], warnings, file);
    const columnNames = new Set(columns.map((column) => column.name));
    if (!columnNames.has('key') || !columnNames.has('value')) continue;

    const rows = safeAll(
      db,
      `select key, value from ${quoteIdentifier(table)} where lower(key) like '%chat%' or lower(key) like '%composer%' or lower(key) like '%bubble%' or lower(key) like '%conversation%'`,
      [],
      warnings,
      file
    );

    for (const row of rows) {
      const key = String(row.key ?? '');
      if (!keyPattern.test(key)) continue;

      const json = parseJsonValue(row.value);
      if (!json.ok) continue;

      const session = cursorSession(file, key, json.value);
      for (const message of extractCursorMessages(json.value)) {
        records.push({
          id: `cursor:${file}:${table}:${key}:${records.length}`,
          tool: 'cursor',
          session,
          project,
          role: message.role,
          ts: toIso(message.ts),
          text: message.text
        });
      }
    }
  }

  return dedupeRecords(records);
}

function extractCursorMessages(root) {
  const messages = [];
  const stack = [root];
  const seen = new Set();

  while (stack.length) {
    const value = stack.pop();
    if (!value || typeof value !== 'object') continue;
    if (seen.has(value)) continue;
    seen.add(value);

    const message = normalizeCursorMessage(value);
    if (message) messages.push(message);

    if (Array.isArray(value)) {
      for (const item of value) stack.push(item);
    } else {
      for (const item of Object.values(value)) stack.push(item);
    }
  }

  return messages.reverse();
}

function normalizeCursorMessage(value) {
  const role = cursorRoleFromType(value.type) ?? normalizeRole(value.role ?? value.speaker ?? value.author);
  const text = extractCursorText(value);
  if (role && text) {
    return {
      role,
      text,
      ts: value.timestamp ?? value.createdAt ?? value.lastUpdatedAt ?? value.unixMs ?? value.time ?? value.date
    };
  }

  return null;
}

function extractCursorText(value) {
  const candidates = [
    value.text,
    value.content,
    value.message,
    value.markdown,
    value.rawText,
    value.richText,
    value.response,
    value.prompt,
    value.bubble?.text,
    value.bubble?.content
  ];

  for (const candidate of candidates) {
    const text = extractTextContent(candidate);
    if (text) return text;
  }

  return '';
}

function cursorRoleFromType(value) {
  if (value === 1) return 'user';
  if (value === 2) return 'assistant';
  return null;
}

function normalizeRole(value) {
  const role = String(value ?? '').toLowerCase();
  if (role === 'user' || role === 'human') return 'user';
  if (role === 'assistant' || role === 'ai' || role === 'bot' || role === 'agent') return 'assistant';
  return null;
}

function parseJsonValue(value) {
  const text = decodeValue(value).trim();
  if (!text || (!text.startsWith('{') && !text.startsWith('['))) return { ok: false };

  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

function decodeValue(value) {
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  if (typeof value === 'string') return value;
  return '';
}

function cursorSession(file, key, value) {
  const bubbleMatch = key.match(/^bubbleId:([^:]+):/);
  if (bubbleMatch) return `${file}#${bubbleMatch[1]}`;

  const id = value?.composerId ?? value?.conversationId ?? value?.chatId ?? key;
  return `${file}#${id}`;
}

function inferCursorProject(file) {
  const workspaceStorage = `${path.sep}workspaceStorage${path.sep}`;
  if (file.includes(workspaceStorage)) {
    return path.basename(path.dirname(file));
  }
  return 'global';
}

function dedupeRecords(records) {
  const seen = new Set();
  const deduped = [];
  for (const record of records) {
    const key = `${record.session}\0${record.role}\0${compactText(record.text)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(record);
  }
  return deduped;
}

function safeAll(db, sql, params, warnings, file) {
  try {
    return db.prepare(sql).all(...params);
  } catch (error) {
    warnings.push(`Cursor warning ${file}: ${error.message}`);
    return [];
  }
}

function quoteIdentifier(identifier) {
  return `"${String(identifier).replaceAll('"', '""')}"`;
}
