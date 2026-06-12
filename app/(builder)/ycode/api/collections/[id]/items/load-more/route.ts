import { NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { getItemsByCollectionId } from '@/lib/repositories/collectionItemRepository';
import { getValuesByItemIds } from '@/lib/repositories/collectionItemValueRepository';
import { getFieldsByCollectionId } from '@/lib/repositories/collectionFieldRepository';
import { enrichItemsWithCountValues } from '@/lib/repositories/collectionCountRepository';
import { getAllPages } from '@/lib/repositories/pageRepository';
import { getAllPageFolders } from '@/lib/repositories/pageFolderRepository';
import { renderCollectionItemsToHtml, loadTranslationsForLocale } from '@/lib/page-fetcher';
import { noCache } from '@/lib/api-response';
import { fetchAllRows } from '@/lib/supabase-constants';
import { ProjectScopeAuthorizationError, resolvePublicContentRequestProjectScope } from '@/lib/request-project-scope';
import { applyProjectScopeToQuery } from '@/lib/project-scope';
import type { Layer, CollectionItem, CollectionItemWithValues } from '@/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const IN_CHUNK_SIZE = 150;

async function chunkedQuery<T>(
  build: (chunk: string[]) => PromiseLike<{ data: T[] | null; error: unknown }>,
  itemIds: string[],
): Promise<T[]> {
  if (itemIds.length === 0) return [];
  if (itemIds.length <= IN_CHUNK_SIZE) {
    const { data } = await build(itemIds);
    return data || [];
  }
  const results: T[] = [];
  for (let i = 0; i < itemIds.length; i += IN_CHUNK_SIZE) {
    const { data } = await build(itemIds.slice(i, i + IN_CHUNK_SIZE));
    if (data) results.push(...data);
  }
  return results;
}

async function getAllItemIdsForCollection(
  collectionId: string,
  isPublished: boolean,
  projectId?: string | null,
): Promise<string[]> {
  const client = await getSupabaseAdmin();
  if (!client) throw new Error('Supabase client not configured');

  // Page past Supabase's 1000-row default cap so collections with more items
  // report accurate `total` / `hasMore` instead of stalling at the cap.
  // Match SSR's ordering so any `maxTotal` slice picks the same items.
  const rows = await fetchAllRows<{ id: string }>(async (from, to) => {
    let q = client
      .from('collection_items')
      .select('id')
      .eq('collection_id', collectionId)
      .eq('is_published', isPublished)
      .is('deleted_at', null)
      .order('manual_order', { ascending: true })
      .order('created_at', { ascending: false })
      .range(from, to);
    if (isPublished) q = q.eq('is_publishable', true);
    q = (await applyProjectScopeToQuery(q, client, 'collection_items', projectId)).query;
    return q;
  });

  return rows.map(r => r.id);
}

async function getFieldValuesForItems(
  fieldId: string,
  isPublished: boolean,
  itemIds: string[],
  projectId?: string | null,
): Promise<Map<string, string>> {
  if (itemIds.length === 0) return new Map();
  const client = await getSupabaseAdmin();
  if (!client) throw new Error('Supabase client not configured');

  const rows = await chunkedQuery<{ item_id: string; value: string | null }>(
    async chunk => {
      let query = client
        .from('collection_item_values')
        .select('item_id, value')
        .eq('field_id', fieldId)
        .eq('is_published', isPublished)
        .is('deleted_at', null)
        .in('item_id', chunk);
      query = (await applyProjectScopeToQuery(query, client, 'collection_item_values', projectId)).query;
      return query;
    },
    itemIds,
  );

  const map = new Map<string, string>();
  for (const row of rows) {
    map.set(row.item_id, row.value ?? '');
  }
  return map;
}

function reorderItemsById(items: CollectionItem[], idOrder: string[]): CollectionItem[] {
  const byId = new Map(items.map(item => [item.id, item]));
  const ordered: CollectionItem[] = [];
  for (const id of idOrder) {
    const item = byId.get(id);
    if (item) ordered.push(item);
  }
  return ordered;
}

/**
 * POST /ycode/api/collections/[id]/items/load-more
 * Returns pre-rendered HTML for the next page of a collection. Mirrors the
 * SSR sort (`sortBy` / `sortOrder`) so offset-based paging stays consistent
 * — otherwise a date-sorted SSR list followed by a manual-order DB page
 * yields duplicates.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const projectScope = await resolvePublicContentRequestProjectScope(request);
    const projectId = projectScope.projectId;
    const { id: collectionId } = await params;

    const body = await request.json();
    const {
      offset = 0,
      limit = 10,
      itemIds,
      layerTemplate,
      collectionLayerId,
      collectionLayer,
      sortBy,
      sortOrder = 'asc',
      published: requestedPublished = true,
      localeCode,
      collectionLayerClasses,
      collectionLayerTag,
      isPreview = false,
      pageCollectionItemId,
      pageCollectionSortedItemIds,
      maxTotal,
    } = body;
    const published = projectScope.source === 'authenticated-preview'
      ? requestedPublished !== false
      : true;

    if (!layerTemplate || !Array.isArray(layerTemplate)) {
      return noCache({ error: 'layerTemplate is required and must be an array' }, 400);
    }
    if (!collectionLayerId) {
      return noCache({ error: 'collectionLayerId is required' }, 400);
    }

    const pageOffset = Math.max(0, isNaN(offset) ? 0 : offset);
    const pageLimit = isNaN(limit) || limit < 1 ? 10 : Math.min(limit, 100);

    // Pool of candidate ids: either the explicit list (multi-reference filter)
    // or every item in the collection. When SSR enforced a `maxTotal` cap
    // (from `collection.limit` with pagination enabled), clamp the pool so
    // `hasMore` and offset-based paging stop at the same boundary.
    let candidateIds = Array.isArray(itemIds) && itemIds.length > 0
      ? itemIds
      : await getAllItemIdsForCollection(collectionId, published, projectId);

    if (typeof maxTotal === 'number' && maxTotal > 0 && candidateIds.length > maxTotal) {
      candidateIds = candidateIds.slice(0, maxTotal);
    }

    const total = candidateIds.length;

    let pageRawItems: CollectionItem[] = [];

    if (!sortBy || sortBy === 'none' || sortBy === 'manual') {
      const { items } = await getItemsByCollectionId(collectionId, published, {
        itemIds: candidateIds,
        limit: pageLimit,
        offset: pageOffset,
      }, projectId);
      pageRawItems = items;
    } else if (sortBy === 'random') {
      // Random sort is unstable across requests; without a seed we can't
      // reliably page it, so fall back to manual order to avoid duplicates.
      const { items } = await getItemsByCollectionId(collectionId, published, {
        itemIds: candidateIds,
        limit: pageLimit,
        offset: pageOffset,
      }, projectId);
      pageRawItems = items;
    } else {
      const sortValueByItem = await getFieldValuesForItems(sortBy, published, candidateIds, projectId);
      const sortedIds = [...candidateIds].sort((a, b) => {
        const aStr = String(sortValueByItem.get(a) || '');
        const bStr = String(sortValueByItem.get(b) || '');
        const aNum = aStr.trim() !== '' ? Number(aStr) : NaN;
        const bNum = bStr.trim() !== '' ? Number(bStr) : NaN;
        if (!isNaN(aNum) && !isNaN(bNum)) {
          return sortOrder === 'desc' ? bNum - aNum : aNum - bNum;
        }
        return sortOrder === 'desc' ? bStr.localeCompare(aStr) : aStr.localeCompare(bStr);
      });
      const pageItemIds = sortedIds.slice(pageOffset, pageOffset + pageLimit);
      if (pageItemIds.length > 0) {
        const { items } = await getItemsByCollectionId(collectionId, published, {
          itemIds: pageItemIds,
        }, projectId);
        pageRawItems = reorderItemsById(items, pageItemIds);
      }
    }

    const valuesByItem = await getValuesByItemIds(pageRawItems.map(i => i.id), published, undefined, undefined, projectId);
    const items: CollectionItemWithValues[] = pageRawItems.map(item => ({
      ...item,
      values: valuesByItem[item.id] || {},
    }));

    await enrichItemsWithCountValues(items, collectionId, published);

    const collectionItemSlugs: Record<string, string> = {};
    const collectionFields = await getFieldsByCollectionId(collectionId, published, { excludeComputed: true }, projectId);
    const slugField = collectionFields.find(f => f.key === 'slug');
    if (slugField) {
      for (const item of items) {
        if (item.values[slugField.id]) {
          collectionItemSlugs[item.id] = item.values[slugField.id];
        }
      }
    }

    const [pages, folders] = await Promise.all([
      getAllPages(undefined, projectId),
      getAllPageFolders(undefined, projectId),
    ]);

    let locale = null;
    let translations: Awaited<ReturnType<typeof loadTranslationsForLocale>>['translations'] | undefined;
    if (localeCode) {
      const localeData = await loadTranslationsForLocale(localeCode, published, undefined, projectId);
      locale = localeData.locale;
      translations = localeData.translations;
    }

    const html = await renderCollectionItemsToHtml(
      items,
      layerTemplate as Layer[],
      collectionId,
      collectionLayerId,
      published,
      pages,
      folders,
      collectionItemSlugs,
      locale,
      translations,
      undefined,
      collectionLayerClasses,
      collectionLayerTag,
      {
        isPreview: Boolean(isPreview),
        pageCollectionItemId,
        pageCollectionSortedItemIds: Array.isArray(pageCollectionSortedItemIds)
          ? pageCollectionSortedItemIds
          : undefined,
      },
      collectionLayer as Omit<Layer, 'children'> | undefined,
      projectId,
    );

    return noCache({
      data: {
        items,
        html,
        total,
        offset: pageOffset,
        limit: pageLimit,
        hasMore: pageOffset + items.length < total,
      }
    });
  } catch (error) {
    console.error('Error fetching collection items for load-more:', error);
    if (error instanceof ProjectScopeAuthorizationError) {
      return noCache({ error: error.message }, 403);
    }

    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to fetch items' },
      500
    );
  }
}
