import { createRequire } from 'node:module';
import { compactText, toIso } from './text.js';

const require = createRequire(import.meta.url);
const requiredColumns = {
  session: ['id', 'directory'],
  message: ['id', 'session_id', 'time_created', 'data'],
  part: ['id', 'message_id', 'data']
};

export function parseOpenCodeFile(file, warnings = [], options = {}) {
  const Database = loadDatabase(warnings, options.loadDatabase);
  if (!Database) return [];

  let db;
  try {
    db = openDatabase(Database, file);
    validateSchema(db);
    return extractMessages(db, file, warnings);
  } catch (error) {
    warnings.push(`OpenCode skipped ${file}: ${error.message}`);
    return [];
  } finally {
    closeDatabase(db);
  }
}

export function inspectOpenCodeFile(file, options = {}) {
  const warnings = [];
  const Database = loadDatabase(warnings, options.loadDatabase);
  if (!Database) return { ok: false, error: warnings[0] };

  let db;
  try {
    db = openDatabase(Database, file);
    validateSchema(db);
    return { ok: true, error: null };
  } catch (error) {
    return { ok: false, error: error.message };
  } finally {
    closeDatabase(db);
  }
}

function loadDatabase(warnings, loader = defaultDatabaseLoader) {
  try {
    return loader();
  } catch (error) {
    warnings.push(`OpenCode skipped: better-sqlite3 could not load (${error.message})`);
    return null;
  }
}

function defaultDatabaseLoader() {
  return require('better-sqlite3');
}

function openDatabase(Database, file) {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  db.pragma('query_only = ON');
  return db;
}

function validateSchema(db) {
  const tables = new Set(db.prepare(
    "select name from sqlite_master where type = 'table'"
  ).all().map((row) => row.name));

  for (const [table, columns] of Object.entries(requiredColumns)) {
    if (!tables.has(table)) throw new Error(`required table ${table} was not found`);
    const actual = new Set(db.prepare(`pragma table_info(\"${table}\")`).all().map((row) => row.name));
    const missing = columns.filter((column) => !actual.has(column));
    if (missing.length) throw new Error(`table ${table} is missing column(s): ${missing.join(', ')}`);
  }
}

function extractMessages(db, file, warnings) {
  const rows = db.prepare(`
    select
      m.id as message_id,
      m.session_id,
      m.time_created,
      m.data as message_data,
      s.directory,
      p.id as part_id,
      p.data as part_data
    from message m
    join session s on s.id = m.session_id
    left join part p on p.message_id = m.id
    order by m.time_created, m.id, p.id
  `).all();
  const records = [];
  let malformed = 0;
  let current = null;

  const flush = () => {
    if (!current) return;
    const role = normalizeRole(current.message?.role);
    const text = current.parts.join('\n').trim();
    if (!role || !text) return;
    records.push({
      id: `opencode:${file}:${current.messageId}`,
      tool: 'opencode',
      session: `${file}#${current.sessionId}`,
      project: current.directory ?? null,
      role,
      ts: toIso(current.message?.time?.created ?? current.timeCreated),
      text
    });
  };

  for (const row of rows) {
    if (current?.messageId !== row.message_id) {
      flush();
      const message = parseJson(row.message_data);
      if (!message.ok) malformed += 1;
      current = {
        messageId: row.message_id,
        sessionId: row.session_id,
        directory: row.directory,
        timeCreated: row.time_created,
        message: message.value,
        parts: []
      };
    }

    if (row.part_data === null || row.part_data === undefined) continue;
    const part = parseJson(row.part_data);
    if (!part.ok) {
      malformed += 1;
      continue;
    }
    if (
      part.value?.type !== 'text' ||
      part.value.synthetic === true ||
      part.value.ignored === true
    ) {
      continue;
    }
    const text = compactText(part.value.text);
    if (text) current.parts.push(text);
  }
  flush();

  if (malformed) {
    warnings.push(`OpenCode skipped ${malformed} malformed message/part JSON value(s) in ${file}`);
  }
  return records;
}

function parseJson(value) {
  try {
    const text = Buffer.isBuffer(value) ? value.toString('utf8') : String(value);
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object'
      ? { ok: true, value: parsed }
      : { ok: false, value: null };
  } catch {
    return { ok: false, value: null };
  }
}

function normalizeRole(value) {
  return value === 'user' || value === 'assistant' ? value : null;
}

function closeDatabase(db) {
  if (!db) return;
  try {
    db.close();
  } catch {
    // The source database was opened read-only; there is no recovery work to do.
  }
}
