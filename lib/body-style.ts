export type SafeBodyStyleDeclaration = {
  prop: string;
  value: string;
  priority: string;
};

export const SAFE_BODY_STYLE_PROPS = new Set([
  'background',
  'background-color',
  'color',
  'font',
  'font-family',
  'font-feature-settings',
  'font-kerning',
  'font-optical-sizing',
  'font-size',
  'font-synthesis',
  'font-variant',
  'font-variant-numeric',
  'font-weight',
  'letter-spacing',
  'line-height',
  'text-rendering',
  '-webkit-font-smoothing',
]);

function isSafeBodyStyleValue(value: string): boolean {
  return !/[<>{}]/.test(value) && !/\/\*|\*\//.test(value) && !/url\s*\(|@import|expression\s*\(/i.test(value);
}

function splitCssDeclarations(style: string): string[] {
  const declarations: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let escaped = false;
  let parenDepth = 0;

  for (const char of style) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === '\\') {
      current += char;
      escaped = true;
      continue;
    }

    if (quote) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }

    if (char === '"' || char === "'") {
      current += char;
      quote = char;
      continue;
    }

    if (char === '(') {
      parenDepth += 1;
      current += char;
      continue;
    }

    if (char === ')') {
      parenDepth = Math.max(0, parenDepth - 1);
      current += char;
      continue;
    }

    if (char === ';' && parenDepth === 0) {
      declarations.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  if (current.trim()) declarations.push(current);
  return declarations;
}

export function parseSafeBodyStyle(style?: string): SafeBodyStyleDeclaration[] {
  if (!style) return [];

  return splitCssDeclarations(style)
    .map((declaration) => {
      const colon = declaration.indexOf(':');
      if (colon === -1) return null;

      const prop = declaration.slice(0, colon).trim().toLowerCase();
      let value = declaration.slice(colon + 1).trim();
      let priority = '';

      if (!/^-?[a-z][a-z0-9-]*$/.test(prop)) return null;
      if (/!important$/i.test(value)) {
        value = value.replace(/!important$/i, '').trim();
        priority = 'important';
      }
      if (!SAFE_BODY_STYLE_PROPS.has(prop) || !value || !isSafeBodyStyleValue(value)) return null;

      return { prop, value, priority };
    })
    .filter((declaration): declaration is SafeBodyStyleDeclaration => Boolean(declaration));
}
