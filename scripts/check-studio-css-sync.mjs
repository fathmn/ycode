/* global process, console */

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const canonicalPath = 'app/studio-design.css';
const targetPath = 'app/globals.css';
const previewLength = 120;

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ');
}

function normalizeWhitespace(source) {
  return source.replace(/\s+/g, ' ').trim();
}

function findNextTopLevelToken(source, startIndex) {
  let quote = null;

  for (let index = startIndex; index < source.length; index += 1) {
    const char = source[index];

    if (quote) {
      if (char === '\\') {
        index += 1;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === '{' || char === ';') {
      return { char, index };
    }
  }

  return null;
}

function findMatchingBrace(source, openIndex) {
  let depth = 0;
  let quote = null;

  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];

    if (quote) {
      if (char === '\\') {
        index += 1;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  throw new Error(`Unbalanced CSS braces near index ${openIndex}`);
}

function splitTopLevelUnits(source) {
  const units = [];
  let index = 0;

  while (index < source.length) {
    while (index < source.length && /\s/.test(source[index])) index += 1;
    if (index >= source.length) break;

    const token = findNextTopLevelToken(source, index);
    if (!token) {
      const trailing = source.slice(index).trim();
      if (trailing.length > 0) units.push({ text: trailing, header: trailing, inner: '' });
      break;
    }

    if (token.char === ';') {
      const text = source.slice(index, token.index + 1).trim();
      if (text.length > 0) units.push({ text, header: text.slice(0, -1).trim(), inner: '' });
      index = token.index + 1;
      continue;
    }

    const closeIndex = findMatchingBrace(source, token.index);
    const text = source.slice(index, closeIndex + 1).trim();
    const header = source.slice(index, token.index).trim();
    const inner = source.slice(token.index + 1, closeIndex);
    if (text.length > 0) units.push({ text, header, inner });
    index = closeIndex + 1;
  }

  return units;
}

function unwrapCanonicalLayers(source) {
  return splitTopLevelUnits(source)
    .map((unit) => {
      if (/^@layer\s+(?:base|utilities)\b/.test(unit.header)) {
        return unit.inner;
      }

      return unit.text;
    })
    .join('\n\n');
}

function extractCanonicalUnits(source) {
  const withoutComments = stripComments(source);
  const unwrapped = unwrapCanonicalLayers(withoutComments);
  return splitTopLevelUnits(unwrapped)
    .map((unit) => normalizeWhitespace(unit.text))
    .filter(Boolean);
}

const canonicalUnits = extractCanonicalUnits(readProjectFile(canonicalPath));
const normalizedTarget = normalizeWhitespace(stripComments(readProjectFile(targetPath)));

if (canonicalUnits.length === 0) {
  console.error(`No Studio CSS rules found in ${canonicalPath}.`);
  process.exit(1);
}

const missingUnits = canonicalUnits.filter((unit) => !normalizedTarget.includes(unit));

if (missingUnits.length > 0) {
  console.error(
    `Studio CSS sync failed: ${missingUnits.length} of ${canonicalUnits.length} rules missing from ${targetPath}.`,
  );

  for (const unit of missingUnits) {
    const preview = unit.length > previewLength ? `${unit.slice(0, previewLength)}...` : unit;
    console.error(`- ${preview}`);
    console.error(
      `  Rule from ${canonicalPath} not found verbatim in ${targetPath} — keep the studio-design rules mirrored in both files.`,
    );
  }

  process.exit(1);
}

console.log(`✓ studio-design CSS in sync with globals.css (${canonicalUnits.length} rules verified)`);
