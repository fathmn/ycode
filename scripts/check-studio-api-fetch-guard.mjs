/* global process, console */

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

const scanRoots = [
  'app/(builder)/ycode',
  'components',
  'hooks',
  'stores',
  'lib',
];

const excludedPrefixes = [
  'app/(builder)/ycode/api/',
  'app/(site)/',
  'lib/apps/',
  'lib/services/',
  'database/',
];

const allowedPublicEndpoints = [
  '/ycode/api/setup/status',
  '/ycode/api/supabase/config',
];

const allowedFiles = new Set([
  'components/LayerRenderer.tsx',
  'components/StudioRuntimeInitializer.tsx',
  'components/FilterableCollection.tsx',
  'components/LoadMoreCollection.tsx',
]);

const fetchPattern = /(?<!studio)fetch\s*\(\s*([`'"])([^`'"]*\/ycode\/api[^`'"]*)\1/g;
const apiUrlVariablePattern = /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*([`'"])([^`'"]*\/ycode\/api[^`'"]*)\2/g;
const variableFetchPattern = /(?<!studio)fetch\s*\(\s*([A-Za-z_$][\w$]*)\b/g;
const findings = [];

function isCodeFile(filePath) {
  return /\.(ts|tsx|js|jsx)$/.test(filePath);
}

function walk(relativeDir) {
  const absoluteDir = path.join(root, relativeDir);
  if (!fs.existsSync(absoluteDir)) return [];

  const files = [];
  for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
    const relativePath = path.join(relativeDir, entry.name);
    if (excludedPrefixes.some((prefix) => relativePath.startsWith(prefix))) continue;

    if (entry.isDirectory()) {
      files.push(...walk(relativePath));
    } else if (isCodeFile(relativePath)) {
      files.push(relativePath);
    }
  }
  return files;
}

function isAllowed(relativePath, endpoint) {
  if (allowedFiles.has(relativePath)) return true;
  return allowedPublicEndpoints.includes(endpoint);
}

for (const file of scanRoots.flatMap(walk)) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const apiUrlVariables = new Map();

  let variableMatch;
  while ((variableMatch = apiUrlVariablePattern.exec(source))) {
    apiUrlVariables.set(variableMatch[1], variableMatch[3]);
  }

  let match;
  while ((match = fetchPattern.exec(source))) {
    const endpoint = match[2];
    if (isAllowed(file, endpoint)) continue;

    const line = source.slice(0, match.index).split('\n').length;
    findings.push(`${file}:${line} uses raw fetch(${match[1]}${endpoint}${match[1]})`);
  }

  while ((match = variableFetchPattern.exec(source))) {
    const variableName = match[1];
    const endpoint = apiUrlVariables.get(variableName);
    if (!endpoint || isAllowed(file, endpoint)) continue;

    const line = source.slice(0, match.index).split('\n').length;
    findings.push(`${file}:${line} uses raw fetch(${variableName}) for protected ${endpoint}`);
  }
}

if (findings.length > 0) {
  console.error('Protected /ycode/api client fetches must use studioFetch:');
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log('Studio fetch guard passed.');
