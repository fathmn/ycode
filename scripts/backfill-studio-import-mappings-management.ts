import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  normalizeStudioImportLayers,
  type StudioImportNormalizationStats,
  type StudioImportPageTarget,
} from '../lib/studio-import-normalizer';
import { DEFAULT_TEXT_STYLES } from '../lib/text-format-utils';
import type { Layer } from '../types';

const DEFAULT_PROJECT_REF = 'ueeecqiswvxpfpmujrtj';

interface SqlPageRow {
  id: string;
  page_folder_id: string | null;
  settings: Record<string, any> | null;
}

interface SqlFolderRow {
  id: string;
  slug: string | null;
  settings: Record<string, any> | null;
}

interface SqlLayerRow {
  id: string;
  is_published: boolean | null;
  layers: Layer[] | null;
}

let compilerCache: { build: (candidates: string[]) => string } | null = null;
type TailwindCompile = (input: string, options: Record<string, any>) => Promise<{ build: (candidates: string[]) => string }>;

function readArg(name: string): string | null {
  const prefix = `--${name}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

async function querySql<T>(sql: string): Promise<T[]> {
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
  if (!accessToken) throw new Error('SUPABASE_ACCESS_TOKEN is required.');

  const projectRef = readArg('project-ref') || process.env.SUPABASE_PROJECT_REF || DEFAULT_PROJECT_REF;
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Supabase SQL query failed (${response.status}): ${body}`);
  }

  return response.json() as Promise<T[]>;
}

function normalizeRoute(route: string): string {
  if (!route || route === '/') return '/';
  return route.startsWith('/') ? route.replace(/\/+$/, '') || '/' : `/${route.replace(/\/+$/, '')}`;
}

function routeFromPage(page: SqlPageRow, folderById: Map<string, SqlFolderRow>): string | null {
  const settingsRoute = page.settings?.studio_import?.route;
  if (typeof settingsRoute === 'string' && settingsRoute) return normalizeRoute(settingsRoute);

  if (!page.page_folder_id) return '/';
  const folder = folderById.get(page.page_folder_id);
  const folderSettingsRoute = folder?.settings?.studio_import?.route;
  if (typeof folderSettingsRoute === 'string' && folderSettingsRoute) return normalizeRoute(folderSettingsRoute);

  return folder?.slug ? normalizeRoute(folder.slug) : null;
}

function addStats(target: StudioImportNormalizationStats, source: StudioImportNormalizationStats) {
  target.layersVisited += source.layersVisited;
  target.linksNormalized += source.linksNormalized;
  target.inlineStylesConverted += source.inlineStylesConverted;
  target.inlineStyleDeclarationsRemoved += source.inlineStyleDeclarationsRemoved;
  target.classesAdded += source.classesAdded;
  target.designObjectsAdded += source.designObjectsAdded;
}

function emptyStats(): StudioImportNormalizationStats {
  return {
    layersVisited: 0,
    linksNormalized: 0,
    inlineStylesConverted: 0,
    inlineStyleDeclarationsRemoved: 0,
    classesAdded: 0,
    designObjectsAdded: 0,
  };
}

async function updateJsonColumn(table: string, id: string, column: string, value: unknown) {
  const json = JSON.stringify(value);
  await querySql(`
    update public.${table}
    set ${column} = ${sqlLiteral(json)}::jsonb
    where id = ${sqlLiteral(id)}
  `);
}

async function updateProjectSetting(projectId: string, key: 'draft_css' | 'published_css', value: string) {
  await querySql(`
    update public.settings
    set value = ${sqlLiteral(JSON.stringify(value))}::jsonb,
        updated_at = now()
    where project_id = ${sqlLiteral(projectId)}
      and key = ${sqlLiteral(key)}
  `);
}

function extractClassesFromLayers(layers: Layer[]): string[] {
  const classes = new Set<string>();

  const extractClasses = (classValue: string | string[] | undefined) => {
    if (!classValue) return;

    if (Array.isArray(classValue)) {
      classValue.forEach((cls) => extractClasses(cls));
      return;
    }

    classValue.split(/\s+/).forEach((cls) => {
      const trimmed = cls.trim();
      if (trimmed) classes.add(trimmed);
    });
  };

  const processLayer = (layer: Layer) => {
    if (layer.settings?.hidden) return;

    extractClasses(layer.classes);
    if (layer.textStyles) {
      Object.values(layer.textStyles).forEach((style) => extractClasses(style.classes));
    }
    if (layer.variables?.text) {
      Object.values(DEFAULT_TEXT_STYLES).forEach((style) => extractClasses(style.classes));
    }
    layer.children?.forEach(processLayer);
  };

  layers.forEach(processLayer);
  return Array.from(classes);
}

async function getCompiler() {
  if (compilerCache) return compilerCache;

  const twPath = join(process.cwd(), 'node_modules/tailwindcss/index.css');
  const input = await readFile(twPath, 'utf-8');
  const moduleName = 'tailwindcss';
  const tailwind = await import(moduleName) as { compile: TailwindCompile };

  compilerCache = await tailwind.compile(input, {
    base: process.cwd(),
    async loadStylesheet(id: string, base: string) {
      const fullPath = join(dirname(base), id);
      const content = await readFile(fullPath, 'utf-8');
      return { path: fullPath, content, base: dirname(fullPath) };
    },
  });

  if (!compilerCache) throw new Error('Failed to initialize Tailwind compiler.');
  return compilerCache;
}

async function compileCss(layers: Layer[]): Promise<string> {
  const classNames = extractClassesFromLayers(layers);
  if (classNames.length === 0) return '/* No classes to generate */';
  const compiler = await getCompiler();
  return compiler.build(classNames);
}

async function regenerateProjectCss(projectId: string) {
  const [draftRows, publishedRows, draftComponentRows, publishedComponentRows] = await Promise.all([
    querySql<SqlLayerRow>(`
      select id, is_published, layers
      from public.page_layers
      where project_id = ${sqlLiteral(projectId)}
        and is_published = false
        and deleted_at is null
    `),
    querySql<SqlLayerRow>(`
      select id, is_published, layers
      from public.page_layers
      where project_id = ${sqlLiteral(projectId)}
        and is_published = true
        and deleted_at is null
    `),
    querySql<SqlLayerRow>(`
      select id, is_published, layers
      from public.components
      where project_id = ${sqlLiteral(projectId)}
        and is_published = false
        and deleted_at is null
    `),
    querySql<SqlLayerRow>(`
      select id, is_published, layers
      from public.components
      where project_id = ${sqlLiteral(projectId)}
        and is_published = true
        and deleted_at is null
    `),
  ]);

  const draftLayers = [...draftRows, ...draftComponentRows].flatMap((row) => Array.isArray(row.layers) ? row.layers : []);
  const publishedLayers = [...publishedRows, ...publishedComponentRows].flatMap((row) => Array.isArray(row.layers) ? row.layers : []);
  const draftCss = await compileCss(draftLayers);
  const publishedCss = await compileCss(publishedLayers);

  await updateProjectSetting(projectId, 'draft_css', draftCss);
  await updateProjectSetting(projectId, 'published_css', publishedCss);

  return {
    draftCssLength: draftCss.length,
    publishedCssLength: publishedCss.length,
    draftLayerRoots: draftLayers.length,
    publishedLayerRoots: publishedLayers.length,
  };
}

async function loadProjectId(projectSlug: string): Promise<string> {
  const rows = await querySql<{ id: string }>(`
    select id
    from public.studio_projects
    where slug = ${sqlLiteral(projectSlug)}
    limit 1
  `);
  if (!rows[0]?.id) throw new Error(`Studio project not found for slug: ${projectSlug}`);
  return rows[0].id;
}

async function loadPageTargets(projectId: string): Promise<StudioImportPageTarget[]> {
  const [pages, folders] = await Promise.all([
    querySql<SqlPageRow>(`
      select id, page_folder_id, settings
      from public.pages
      where project_id = ${sqlLiteral(projectId)}
        and deleted_at is null
    `),
    querySql<SqlFolderRow>(`
      select id, slug, settings
      from public.page_folders
      where project_id = ${sqlLiteral(projectId)}
        and deleted_at is null
    `),
  ]);

  const folderById = new Map(folders.map((folder) => [folder.id, folder]));
  return pages
    .map((page) => ({ id: page.id, route: routeFromPage(page, folderById) }))
    .filter((page): page is StudioImportPageTarget => Boolean(page.route));
}

async function backfillTable(
  table: 'page_layers' | 'components',
  projectId: string,
  pageTargets: StudioImportPageTarget[],
  write: boolean,
) {
  const rows = await querySql<SqlLayerRow>(`
    select id, is_published, layers
    from public.${table}
    where project_id = ${sqlLiteral(projectId)}
      and deleted_at is null
  `);

  const totals = emptyStats();
  let changedRows = 0;

  for (const row of rows) {
    if (!Array.isArray(row.layers)) continue;
    const result = normalizeStudioImportLayers(row.layers, pageTargets);
    addStats(totals, result.stats);
    if (!result.changed) continue;

    changedRows += 1;
    if (write) {
      await updateJsonColumn(table, row.id, 'layers', result.layers);
    }
  }

  return { table, rowsScanned: rows.length, changedRows, stats: totals };
}

async function main() {
  const projectSlug = readArg('studio-project') || process.env.STUDIO_PROJECT_SLUG || 'hr-interim-solutions';
  const write = hasFlag('write');
  const projectId = await loadProjectId(projectSlug);
  const pageTargets = await loadPageTargets(projectId);

  const results = await Promise.all([
    backfillTable('page_layers', projectId, pageTargets, write),
    backfillTable('components', projectId, pageTargets, write),
  ]);
  const css = write ? await regenerateProjectCss(projectId) : null;

  console.log(JSON.stringify({
    mode: write ? 'write' : 'dry-run',
    projectSlug,
    projectId,
    pageTargets: pageTargets.length,
    results,
    css,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
