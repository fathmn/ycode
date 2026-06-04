function titleCaseToken(token: string): string {
  const acronyms = new Set(['cta', 'seo', 'cms', 'ui', 'url', 'id']);

  return token
    .replace(/^(?:font|color|studio)-/, '')
    .replace(/[-_]/g, ' ')
    .split(' ')
    .map((part) => acronyms.has(part.toLowerCase()) ? part.toUpperCase() : part.replace(/\b\w/g, (char) => char.toUpperCase()))
    .join(' ')
    .trim();
}

function splitTopLevelComma(value: string): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  let quote: string | null = null;

  for (const char of value) {
    if (quote) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }

    if (char === '(') depth += 1;
    if (char === ')' && depth > 0) depth -= 1;

    if (char === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  if (current.trim()) parts.push(current.trim());
  return parts;
}

export function formatCssVariableLabel(value: string): string | null {
  const match = value.match(/var\(\s*--([a-z0-9_-]+)(?:\s*,\s*([^)]+))?\)/i);
  if (!match) return null;

  const token = titleCaseToken(match[1]);
  const fallback = match[2]
    ? splitTopLevelComma(match[2])[0]?.trim().replace(/^["']|["']$/g, '')
    : null;
  return fallback ? `${token} (${fallback})` : token;
}

export function formatClampLabel(value: string): string | null {
  const match = value.match(/^clamp\((.+)\)$/i);
  if (!match) return null;

  const parts = splitTopLevelComma(match[1]);
  if (parts.length !== 3) return null;

  return `Responsive: ${parts[0]} bis ${parts[2]}`;
}

export function formatIntrinsicSizeLabel(value: string): string | null {
  const labels: Record<string, string> = {
    'max-content': 'Inhalt: maximale Breite',
    'min-content': 'Inhalt: minimale Breite',
    'fit-content': 'Inhalt: passend',
  };

  return labels[value] || null;
}

export function formatDesignValueHint(value: string | null | undefined): string | null {
  if (!value) return null;

  return formatCssVariableLabel(value)
    || formatClampLabel(value)
    || formatIntrinsicSizeLabel(value)
    || null;
}
