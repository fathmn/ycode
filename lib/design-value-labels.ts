const KNOWN_TOKEN_LABELS: Record<string, string> = {
  'font-display': 'Display',
  'font-spectral': 'Display',
  'font-body': 'Body',
  'font-inter': 'Body',
  'font-sans': 'Sans',
  'font-serif': 'Serif',
  'studio-cta-gap': 'CTA Abstand',
  'studio-section-gap': 'Section Abstand',
  'studio-container': 'Container',
};

function titleCaseToken(token: string): string {
  if (token in KNOWN_TOKEN_LABELS) return KNOWN_TOKEN_LABELS[token];

  const acronyms = new Set(['cta', 'seo', 'cms', 'ui', 'url', 'id']);

  return token
    .replace(/^(?:font|color|studio)-/, '')
    .replace(/[-_]/g, ' ')
    .split(' ')
    .map((part) => acronyms.has(part.toLowerCase()) ? part.toUpperCase() : part.replace(/\b\w/g, (char) => char.toUpperCase()))
    .join(' ')
    .trim();
}

function normalizeDesignValue(value: string): string {
  let normalized = value.trim();

  // Tailwind arbitrary values are stored as [clamp(...)] or [var(...)].
  // Controls should display the readable inner value while keeping the stored
  // technical value unchanged when the field is edited.
  while (normalized.startsWith('[') && normalized.endsWith(']')) {
    normalized = normalized.slice(1, -1).trim();
  }

  return normalized;
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

function extractCssVariable(value: string): { name: string; fallback: string | null } | null {
  const normalized = normalizeDesignValue(value);
  const start = normalized.search(/var\(/i);
  if (start < 0) return null;

  let depth = 0;
  let quote: string | null = null;
  let end = -1;
  for (let index = start; index < normalized.length; index += 1) {
    const char = normalized[index];
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '(') depth += 1;
    if (char === ')') {
      depth -= 1;
      if (depth === 0) {
        end = index;
        break;
      }
    }
  }
  if (end < 0) return null;

  const inner = normalized.slice(start + 4, end).trim();
  const parts = splitTopLevelComma(inner);
  const name = parts[0]?.trim().replace(/^--/, '');
  if (!name) return null;

  const fallback = parts[1]?.trim().replace(/^["']|["']$/g, '') || null;
  return { name, fallback };
}

export function formatCssVariableLabel(value: string): string | null {
  const cssVariable = extractCssVariable(value);
  if (!cssVariable) return null;

  const token = titleCaseToken(cssVariable.name);
  return cssVariable.fallback ? `${token} (${cssVariable.fallback})` : token;
}

export function formatClampLabel(value: string): string | null {
  const normalized = normalizeDesignValue(value);
  const match = normalized.match(/^clamp\((.+)\)$/i);
  if (!match) return null;

  const parts = splitTopLevelComma(match[1]);
  if (parts.length !== 3) return null;

  return `Responsive: ${parts[0]} bis ${parts[2]}`;
}

export function formatClampControlValue(value: string): string | null {
  const normalized = normalizeDesignValue(value);
  const match = normalized.match(/^clamp\((.+)\)$/i);
  if (!match) return null;

  const parts = splitTopLevelComma(match[1]);
  if (parts.length !== 3) return null;

  return `${parts[0]} - ${parts[2]}`;
}

export function formatIntrinsicSizeLabel(value: string): string | null {
  const normalized = normalizeDesignValue(value);
  const labels: Record<string, string> = {
    auto: 'Automatisch',
    'max-content': 'Inhalt: maximale Breite',
    'min-content': 'Inhalt: minimale Breite',
    'fit-content': 'Inhalt: passend',
    fit: 'Inhalt: passend',
    min: 'Inhalt: minimale Breite',
    max: 'Inhalt: maximale Breite',
    full: 'Volle Breite',
    screen: 'Viewport',
    '100%': 'Fill',
    '100vw': 'Viewport-Breite',
    '100vh': 'Viewport-Höhe',
    '100svh': 'Viewport-Höhe',
  };

  return labels[normalized] || null;
}

export function formatDesignControlValue(value: string | null | undefined): string | null {
  if (!value) return null;

  return formatClampControlValue(value)
    || formatCssVariableLabel(value)
    || formatIntrinsicSizeLabel(value)
    || null;
}

export function formatDesignValueHint(value: string | null | undefined): string | null {
  if (!value) return null;

  return formatCssVariableLabel(value)
    || formatClampLabel(value)
    || formatIntrinsicSizeLabel(value)
    || null;
}
