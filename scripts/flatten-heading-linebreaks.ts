import { getSupabaseAdmin } from '@/lib/supabase-server';
import { flattenTiptapParagraphs } from '@/lib/text-format-utils';
import type { Layer } from '@/types';

const DEFAULT_TARGET_LAYER_ID = 'studio-import-page-home-home-hero-heading';
const FETCH_PAGE_SIZE = 1000;
const PAGE_ID_CHUNK_SIZE = 200;

type Mode = 'dry-run' | 'apply';

type ProjectPage = {
  id: string;
  name: string | null;
};

type PageLayerRow = {
  id: string;
  page_id: string;
  is_published: boolean;
  layers: unknown;
};

type ReportRow = {
  pageName: string | null;
  isPublished: boolean;
  layerId: string;
  changed: boolean;
};

type LayerMatch = Pick<ReportRow, 'layerId' | 'changed'>;

type FlattenCandidate = {
  row: PageLayerRow;
  changedCount: number;
};

function printUsage() {
  console.error('Usage: npm run studio:flatten-headings -- <projectId> [layerId ...] [--apply]');
}

function parseArgs(): { projectId: string; mode: Mode; targetLayerIds: string[] } {
  const projectId = process.argv[2]?.trim();
  const extraArgs = process.argv.slice(3);

  if (!projectId || projectId.startsWith('--')) {
    printUsage();
    process.exit(1);
  }

  const targetLayerIds: string[] = [];
  let apply = false;

  for (const rawArg of extraArgs) {
    const arg = rawArg.trim();
    if (!arg) continue;

    if (arg === '--apply') {
      apply = true;
      continue;
    }

    if (arg.startsWith('--')) {
      printUsage();
      process.exit(1);
    }

    targetLayerIds.push(arg);
  }

  return {
    projectId,
    mode: apply ? 'apply' : 'dry-run',
    targetLayerIds: targetLayerIds.length > 0 ? Array.from(new Set(targetLayerIds)) : [DEFAULT_TARGET_LAYER_ID],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasMultipleTopLevelBlocks(content: unknown): boolean {
  return isRecord(content)
    && content.type === 'doc'
    && Array.isArray(content.content)
    && content.content.length > 1;
}

function isSameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function flattenTargetLayer(layer: Layer, targetLayerIds: Set<string>): LayerMatch | null {
  if (!targetLayerIds.has(layer.id)) return null;

  let changed = false;
  const textVariable = layer.variables?.text;

  if (textVariable?.type === 'dynamic_rich_text' && hasMultipleTopLevelBlocks(textVariable.data?.content)) {
    const previousContent = textVariable.data.content;
    const flattenedContent = flattenTiptapParagraphs(previousContent);

    if (!isSameJson(previousContent, flattenedContent)) {
      textVariable.data = {
        ...textVariable.data,
        content: flattenedContent,
      };
      changed = true;
    }
  }

  return {
    layerId: layer.id,
    changed,
  };
}

function flattenLayerTree(layers: unknown, targetLayerIds: Set<string>): LayerMatch[] {
  if (!Array.isArray(layers)) return [];

  const rows: LayerMatch[] = [];

  for (const layer of layers as Layer[]) {
    const match = flattenTargetLayer(layer, targetLayerIds);
    if (match) rows.push(match);

    if (Array.isArray(layer.children) && layer.children.length > 0) {
      rows.push(...flattenLayerTree(layer.children, targetLayerIds));
    }
  }

  return rows;
}

function toProjectPage(row: Record<string, unknown>): ProjectPage | null {
  if (typeof row.id !== 'string') return null;

  return {
    id: row.id,
    name: typeof row.name === 'string' ? row.name : null,
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
      .select('id,name')
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
  candidates: FlattenCandidate[]
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
  const { projectId, mode, targetLayerIds } = parseArgs();
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase not configured');
  }

  const targetLayerIdSet = new Set(targetLayerIds);
  const pages = await fetchProjectPages(client, projectId);
  const pageById = new Map(pages.map((page) => [page.id, page]));
  const pageLayerRows = pages.length > 0
    ? await fetchPageLayers(client, pages.map((page) => page.id))
    : [];

  const reportRows: ReportRow[] = [];
  const candidates: FlattenCandidate[] = [];

  for (const row of pageLayerRows) {
    const matches = flattenLayerTree(row.layers, targetLayerIdSet);
    if (matches.length === 0) continue;

    const page = pageById.get(row.page_id);
    const changedCount = matches.filter((match) => match.changed).length;

    reportRows.push(...matches.map((match) => ({
      pageName: page?.name ?? null,
      isPublished: row.is_published,
      layerId: match.layerId,
      changed: match.changed,
    })));

    if (changedCount > 0) {
      candidates.push({ row, changedCount });
    }
  }

  if (mode === 'apply' && candidates.length > 0) {
    await updatePageLayerRows(client, candidates);
  }

  const totalChanged = candidates.reduce((total, candidate) => total + candidate.changedCount, 0);

  console.log(JSON.stringify({
    projectId,
    mode,
    targetLayerIds,
    rows: reportRows,
    totalChanged,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error && error.stack ? error.stack : error);
  process.exit(1);
});
