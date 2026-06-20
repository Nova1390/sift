export function compactText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function toIso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function shortExcerpt(text, max = 220) {
  const clean = compactText(text);
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trimEnd()}...`;
}

export function datePart(ts) {
  return ts ? ts.slice(0, 10) : 'unknown';
}

export function extractTextContent(content) {
  if (typeof content === 'string') return compactText(content);
  if (!Array.isArray(content)) return '';

  const parts = [];
  for (const block of content) {
    if (typeof block === 'string') {
      parts.push(block);
    } else if (block?.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text);
    } else if ((block?.type === 'input_text' || block?.type === 'output_text') && typeof block.text === 'string') {
      parts.push(block.text);
    }
  }
  return compactText(parts.join('\n'));
}
