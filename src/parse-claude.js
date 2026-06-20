import path from 'node:path';
import { readJsonl } from './jsonl.js';
import { compactText, extractTextContent, toIso } from './text.js';

export function parseClaudeFile(file, malformed = []) {
  const records = [];
  const project = path.basename(path.dirname(file));

  readJsonl(
    file,
    (obj, lineNumber) => {
      const role = obj?.message?.role;
      if (role !== 'user' && role !== 'assistant') return;

      const text = extractTextContent(obj.message.content);
      if (!text) return;

      records.push({
        id: `claude:${file}:${lineNumber}`,
        tool: 'claude',
        session: file,
        project,
        role,
        ts: toIso(obj.timestamp ?? obj.message.created_at),
        text: compactText(text)
      });
    },
    (source, line, error) => {
      malformed.push({ tool: 'claude', source, line, error: error.message });
    }
  );

  return records;
}
