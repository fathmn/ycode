import { getSupabaseAdmin } from '@/lib/supabase-server';

const BROKEN_FONT_CLASS_TOKEN_PATTERN = /^font-\[family-name:var\(--font-([a-z0-9-]+)\),(.+)\]$/;
const BROKEN_FONT_DESIGN_VALUE_PATTERN = /^var\(--font-([a-z0-9-]+)\),(.*)$/;
const FETCH_PAGE_SIZE = 1000;
const PAGE_ID_CHUNK_SIZE = 200;

type Mode = 'dry-run' | 'apply';

type ProjectPage = {
  id: string;
  name: string | null;
  slug: string | null;
};

type PageLayerRow = {
  id: string;
  page_id: string;
  is_published: boolean;
  layers: unknown;
};

type ReportRow = {
  pageLayerId: string;
  pageId: string;
  pageName: string | null;
  pageSlug: string | null;
  isPublished: boolean;
  replacements: number;
};

type RepairCandidate = {
  row: PageLayerRow;
  report: ReportRow;
};

function printUsage() {
  console.error('Usage: npm run studio:repair-font-classes -- <projectId> [--apply]');
}

function parseArgs(): { projectId: string; mode: Mode } {
  const projectId = process.argv[2]?.trim();
  const extraArgs = process.argv.slice(3);

  if (!projectId || projectId === '--apply' || extraArgs.some((arg) => arg !== '--apply')) {
    printUsage();
    process.exit(1);
  }

  return {
    projectId,
    mode: extraArgs.includes('--apply') ? 'apply' : 'dry-run',
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function repairClassToken(token: string): { value: string; replacements: number } {
  const match = token.match(BROKEN_FONT_CLASS_TOKEN_PATTERN);
  if (match) {
    return {
      value: `font-[family-name:var(--font-${match[1]},${match[2]})]`,
      replacements: 1,
    };
  }

  return { value: token, replacements: 0 };
}

function repairClassString(classes: string): { value: string; replacements: number } {
  let repaired = '';
  let currentToken = '';
  let bracketDepth = 0;
  let replacements = 0;

  const flushToken = () => {
    if (!currentToken) return;
    const result = repairClassToken(currentToken);
    repaired += result.value;
    replacements += result.replacements;
    currentToken = '';
  };

  for (const char of classes) {
    if (/\s/.test(char) && bracketDepth === 0) {
      flushToken();
      repaired += char;
      continue;
    }

    currentToken += char;

    if (char === '[') {
      bracketDepth += 1;
    } else if (char === ']' && bracketDepth > 0) {
      bracketDepth -= 1;
    }
  }

  flushToken();

  return { value: repaired, replacements };
}

function repairClassesValue(value: unknown): { value: unknown; replacements: number } {
  if (typeof value === 'string') {
    return repairClassString(value);
  }

  if (!Array.isArray(value)) {
    return { value, replacements: 0 };
  }

  let replacements = 0;
  let changed = false;
  const repaired = value.map((item) => {
    if (typeof item !== 'string') return item;

    const result = repairClassString(item);
    replacements += result.replacements;
    if (result.value !== item) changed = true;
    return result.value;
  });

  return { value: changed ? repaired : value, replacements };
}

function repairDesignFontValue(value: string): { value: string; replacements: number } {
  const match = value.trim().match(BROKEN_FONT_DESIGN_VALUE_PATTERN);
  if (match) {
    return {
      value: `var(--font-${match[1]},${match[2]})`,
      replacements: 1,
    };
  }

  return { value, replacements: 0 };
}

function repairLayerTree(value: unknown): number {
  if (Array.isArray(value)) {
    return value.reduce((total, item) => total + repairLayerTree(item), 0);
  }

  if (!isRecord(value)) {
    return 0;
  }

  let replacements = 0;

  for (const [key, propertyValue] of Object.entries(value)) {
    if (key === 'classes') {
      const result = repairClassesValue(propertyValue);
      if (result.replacements > 0) {
        value[key] = result.value;
      }
      replacements += result.replacements;
      continue;
    }

    if (typeof propertyValue === 'string') {
      const result = repairDesignFontValue(propertyValue);
      if (result.replacements > 0) {
        value[key] = result.value;
      }
      replacements += result.replacements;
      continue;
    }

    replacements += repairLayerTree(propertyValue);
  }

  return replacements;
}

function toProjectPage(row: Record<string, unknown>): ProjectPage | null {
  if (typeof row.id !== 'string') return null;

  return {
    id: row.id,
    name: typeof row.name === 'string' ? row.name : null,
    slug: typeof row.slug === 'string' ? row.slug : null,
  };
}

function toPageLayerRow(row: Record<string, unknown>): PageLayerRow | null {
  if (typeof row.id !== 'string' || typeof row.page_id !== 'string') {
    return null;
  }

  return {
    id: row.id,
    page_id: row.page_id,
    is_published: row.is_published === true,
    layers: row.layers,
  };
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function fetchProjectPages(
  client: NonNullable<Awaited<ReturnType<typeof getSupabaseAdmin>>>,
  projectId: string
): Promise<ProjectPage[]> {
  const pages: ProjectPage[] = [];

  for (let from = 0; ; from += FETCH_PAGE_SIZE) {
    const to = from + FETCH_PAGE_SIZE - 1;
    const { data, error } = await client
      .from('pages')
      .select('id,name,slug')
      .eq('project_id', projectId)
      .range(from, to);

    if (error) {
      throw new Error(`Failed to fetch project pages: ${error.message}`);
    }

    const batch = (data ?? [])
      .map((row) => toProjectPage(row as Record<string, unknown>))
      .filter((row): row is ProjectPage => row !== null);
    pages.push(...batch);

    if (!data || data.length < FETCH_PAGE_SIZE) break;
  }

  return pages;
}

async function fetchPageLayers(
  client: NonNullable<Awaited<ReturnType<typeof getSupabaseAdmin>>>,
  pageIds: string[]
): Promise<PageLayerRow[]> {
  const rows: PageLayerRow[] = [];

  for (const pageIdChunk of chunk(pageIds, PAGE_ID_CHUNK_SIZE)) {
    for (let from = 0; ; from += FETCH_PAGE_SIZE) {
      const to = from + FETCH_PAGE_SIZE - 1;
      const { data, error } = await client
        .from('page_layers')
        .select('id,page_id,is_published,layers')
        .in('page_id', pageIdChunk)
        .range(from, to);

      if (error) {
        throw new Error(`Failed to fetch page_layers rows: ${error.message}`);
      }

      const batch = (data ?? [])
        .map((row) => toPageLayerRow(row as Record<string, unknown>))
        .filter((row): row is PageLayerRow => row !== null);
      rows.push(...batch);

      if (!data || data.length < FETCH_PAGE_SIZE) break;
    }
  }

  return rows;
}

async function updatePageLayerRows(
  client: NonNullable<Awaited<ReturnType<typeof getSupabaseAdmin>>>,
  candidates: RepairCandidate[]
) {
  for (const candidate of candidates) {
    const { error } = await client
      .from('page_layers')
      .update({
        layers: candidate.row.layers,
        updated_at: new Date().toISOString(),
      })
      .eq('id', candidate.row.id);

    if (error) {
      throw new Error(`Failed to update page_layers ${candidate.row.id}: ${error.message}`);
    }
  }
}

async function main() {
  const { projectId, mode } = parseArgs();
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase not configured');
  }

  const pages = await fetchProjectPages(client, projectId);
  const pageById = new Map(pages.map((page) => [page.id, page]));
  const pageLayerRows = pages.length > 0
    ? await fetchPageLayers(client, pages.map((page) => page.id))
    : [];

  const candidates: RepairCandidate[] = [];

  for (const row of pageLayerRows) {
    const replacements = repairLayerTree(row.layers);
    if (replacements === 0) continue;

    const page = pageById.get(row.page_id);
    candidates.push({
      row,
      report: {
        pageLayerId: row.id,
        pageId: row.page_id,
        pageName: page?.name ?? null,
        pageSlug: page?.slug ?? null,
        isPublished: row.is_published,
        replacements,
      },
    });
  }

  if (mode === 'apply' && candidates.length > 0) {
    await updatePageLayerRows(client, candidates);
  }

  const totalReplacements = candidates.reduce((total, candidate) => total + candidate.report.replacements, 0);

  console.log(JSON.stringify({
    projectId,
    mode,
    scannedPages: pages.length,
    scannedRows: pageLayerRows.length,
    changedRows: candidates.length,
    rows: candidates.map((candidate) => candidate.report),
    totalReplacements,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error && error.stack ? error.stack : error);
  process.exit(1);
});
