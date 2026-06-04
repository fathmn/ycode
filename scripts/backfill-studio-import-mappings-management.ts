import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import {
  normalizeStudioImportLayers,
  type StudioImportNormalizationStats,
  type StudioImportPageTarget,
} from '../lib/studio-import-normalizer';
import { cleanImportDesign, styleToClasses } from '../lib/html-layer-converter';
import { classesToDesign, propertyToClass, replaceConflictingClasses } from '../lib/tailwind-class-mapper';
import { DEFAULT_TEXT_STYLES } from '../lib/text-format-utils';
import type { DesignProperties, Layer } from '../types';

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

interface SourceStyleRepairStats {
  layersVisited: number;
  sourceStyleMatches: number;
  layersChanged: number;
  propertiesRepaired: number;
  classesAdded: number;
}

interface SourceLayerStyle {
  style: string;
  classes: string[];
  design?: DesignProperties;
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

function resolveInputPath(path: string): string {
  if (isAbsolute(path)) return path;
  return resolve(process.cwd(), path);
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

function emptySourceStyleRepairStats(): SourceStyleRepairStats {
  return {
    layersVisited: 0,
    sourceStyleMatches: 0,
    layersChanged: 0,
    propertiesRepaired: 0,
    classesAdded: 0,
  };
}

function addSourceStyleRepairStats(target: SourceStyleRepairStats, source: SourceStyleRepairStats) {
  target.layersVisited += source.layersVisited;
  target.sourceStyleMatches += source.sourceStyleMatches;
  target.layersChanged += source.layersChanged;
  target.propertiesRepaired += source.propertiesRepaired;
  target.classesAdded += source.classesAdded;
}

function normalizeClassList(classes: Layer['classes'] | undefined): string[] {
  if (Array.isArray(classes)) return classes.filter(Boolean);
  if (typeof classes !== 'string') return [];
  return classes.split(/\s+/).filter(Boolean);
}

function mergeMissingClasses(existing: string[], additions: string[]): { classes: string[]; addedCount: number } {
  const next = [...existing];
  const seen = new Set(next);
  let addedCount = 0;

  for (const cls of additions) {
    if (!cls || seen.has(cls)) continue;
    next.push(cls);
    seen.add(cls);
    addedCount += 1;
  }

  return { classes: next, addedCount };
}

function isEmptyDesignValue(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

function shouldRepairDesignProperty(
  category: keyof DesignProperties,
  property: string,
  currentValue: unknown,
  sourceValue: unknown,
): boolean {
  if (isEmptyDesignValue(sourceValue)) return false;
  if (isEmptyDesignValue(currentValue)) return true;

  if (category === 'typography' && property === 'fontFamily' && typeof sourceValue === 'string') {
    const sourceIsDisplayToken = sourceValue.includes('var(--font-display') || sourceValue.includes('var(--font-spectral');
    if (!sourceIsDisplayToken) return false;

    if (typeof currentValue !== 'string') return true;
    const current = currentValue.trim().toLowerCase();
    return current === 'inter' || current === 'sans' || current === 'serif' || !current.includes('var(--font-');
  }

  return false;
}

function repairLayerFromSourceStyle(
  layer: Layer,
  sourceStyles: Map<string, SourceLayerStyle>,
  stats: SourceStyleRepairStats,
): { layer: Layer; changed: boolean } {
  stats.layersVisited += 1;

  const source = sourceStyles.get(layer.id);
  let changed = false;
  let nextLayer = { ...layer };
  let nextClasses = normalizeClassList(layer.classes);

  if (source?.design) {
    stats.sourceStyleMatches += 1;
    const currentDesign = nextLayer.design || {};
    const repairedDesign: DesignProperties = { ...currentDesign };
    let repairedProperties = 0;

    for (const [category, sourceCategory] of Object.entries(source.design) as [keyof DesignProperties, Record<string, unknown>][]) {
      if (!sourceCategory || typeof sourceCategory !== 'object') continue;
      const currentCategory = (currentDesign[category] || {}) as Record<string, unknown>;
      const nextCategory = { ...currentCategory };

      for (const [property, sourceValue] of Object.entries(sourceCategory)) {
        if (property === 'isActive') continue;
        if (!shouldRepairDesignProperty(category, property, currentCategory[property], sourceValue)) continue;

        nextCategory[property] = sourceValue;
        nextCategory.isActive = true;
        repairedProperties += 1;

        const className = propertyToClass(category, property, String(sourceValue));
        if (className) {
          nextClasses = replaceConflictingClasses(nextClasses, property, className);
        }
      }

      if (Object.keys(nextCategory).length > 0) {
        repairedDesign[category] = nextCategory as any;
      }
    }

    if (repairedProperties > 0) {
      const merged = mergeMissingClasses(nextClasses, source.classes);
      nextClasses = merged.classes;
      stats.classesAdded += merged.addedCount;
      stats.propertiesRepaired += repairedProperties;
      nextLayer = {
        ...nextLayer,
        design: cleanImportDesign(repairedDesign),
        classes: nextClasses.join(' '),
      };
      changed = true;
    }
  }

  if (nextLayer.children?.length) {
    const repairedChildren = nextLayer.children.map((child) => repairLayerFromSourceStyle(child, sourceStyles, stats));
    if (repairedChildren.some((child) => child.changed)) {
      nextLayer = {
        ...nextLayer,
        children: repairedChildren.map((child) => child.layer),
      };
      changed = true;
    }
  }

  if (changed) stats.layersChanged += 1;
  return { layer: nextLayer, changed };
}

function repairLayersFromSourceStyles(layers: Layer[], sourceStyles: Map<string, SourceLayerStyle>) {
  const stats = emptySourceStyleRepairStats();
  const repaired = layers.map((layer) => repairLayerFromSourceStyle(layer, sourceStyles, stats));

  return {
    layers: repaired.map((item) => item.layer),
    changed: repaired.some((item) => item.changed),
    stats,
  };
}

function collectSourceStylesFromNode(node: unknown, styles: Map<string, SourceLayerStyle>) {
  if (!node || typeof node !== 'object') return;

  if (Array.isArray(node)) {
    node.forEach((item) => collectSourceStylesFromNode(item, styles));
    return;
  }

  const maybeLayer = node as Record<string, any>;
  const id = maybeLayer.id;
  const style = maybeLayer.attributes?.style;
  if (typeof id === 'string' && typeof style === 'string' && style.trim()) {
    const classes = styleToClasses(style);
    styles.set(id, {
      style,
      classes,
      design: cleanImportDesign(classesToDesign(classes)),
    });
  }

  for (const value of Object.values(maybeLayer)) {
    collectSourceStylesFromNode(value, styles);
  }
}

async function loadSourceStyles(sourceReportPath: string | null): Promise<Map<string, SourceLayerStyle>> {
  if (!sourceReportPath) return new Map();
  const resolvedPath = resolveInputPath(sourceReportPath);
  const report = JSON.parse(await readFile(resolvedPath, 'utf-8'));
  const styles = new Map<string, SourceLayerStyle>();
  collectSourceStylesFromNode(report.plan?.records ?? report.records ?? report, styles);
  return styles;
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
  sourceStyles: Map<string, SourceLayerStyle>,
  write: boolean,
) {
  const rows = await querySql<SqlLayerRow>(`
    select id, is_published, layers
    from public.${table}
    where project_id = ${sqlLiteral(projectId)}
      and deleted_at is null
  `);

  const totals = emptyStats();
  const sourceStyleTotals = emptySourceStyleRepairStats();
  let changedRows = 0;

  for (const row of rows) {
    if (!Array.isArray(row.layers)) continue;
    const result = normalizeStudioImportLayers(row.layers, pageTargets);
    addStats(totals, result.stats);
    const sourceStyleResult = sourceStyles.size > 0
      ? repairLayersFromSourceStyles(result.layers, sourceStyles)
      : null;
    if (sourceStyleResult) addSourceStyleRepairStats(sourceStyleTotals, sourceStyleResult.stats);

    const nextLayers = sourceStyleResult?.layers || result.layers;
    const rowChanged = result.changed || Boolean(sourceStyleResult?.changed);
    if (!rowChanged) continue;

    changedRows += 1;
    if (write) {
      await updateJsonColumn(table, row.id, 'layers', nextLayers);
    }
  }

  return { table, rowsScanned: rows.length, changedRows, stats: totals, sourceStyleStats: sourceStyleTotals };
}

async function main() {
  const projectSlug = readArg('studio-project') || process.env.STUDIO_PROJECT_SLUG || 'hr-interim-solutions';
  const sourceReportPath = readArg('source-report');
  const write = hasFlag('write');
  const projectId = await loadProjectId(projectSlug);
  const pageTargets = await loadPageTargets(projectId);
  const sourceStyles = await loadSourceStyles(sourceReportPath);

  const results = await Promise.all([
    backfillTable('page_layers', projectId, pageTargets, sourceStyles, write),
    backfillTable('components', projectId, pageTargets, sourceStyles, write),
  ]);
  const css = write ? await regenerateProjectCss(projectId) : null;

  console.log(JSON.stringify({
    mode: write ? 'write' : 'dry-run',
    projectSlug,
    projectId,
    pageTargets: pageTargets.length,
    sourceReportPath,
    sourceStyles: sourceStyles.size,
    results,
    css,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
