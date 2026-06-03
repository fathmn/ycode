import { NextRequest } from 'next/server';
import { getItemsWithValues } from '@/lib/repositories/collectionItemRepository';
import { getFieldsByCollectionId } from '@/lib/repositories/collectionFieldRepository';
import { getAllPages } from '@/lib/repositories/pageRepository';
import { getAllPageFolders } from '@/lib/repositories/pageFolderRepository';
import { renderCollectionItemsToHtml, loadTranslationsForLocale } from '@/lib/page-fetcher';
import { noCache } from '@/lib/api-response';
import { ProjectScopeAuthorizationError, resolvePublicContentRequestProjectScope } from '@/lib/request-project-scope';
import type { Layer } from '@/types';

// Disable caching for this route
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * POST /ycode/api/collections/[id]/items/load-more
 * Get paginated collection items for "Load More" functionality
 * Returns pre-rendered HTML for client-side appending
 *
 * Body (JSON):
 * - offset: number of items to skip (default: 0)
 * - limit: number of items to fetch (default: 10)
 * - itemIds: array of item IDs to filter by (for multi-reference fields)
 * - layerTemplate: Layer[] - the layer template to render items with
 * - collectionLayerId: string - the collection layer ID for unique item IDs
 * - published: whether to fetch published items (default: true for public pages)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const projectScope = await resolvePublicContentRequestProjectScope(request);
    const projectId = projectScope.projectId;
    const { id } = await params;
    const collectionId = id;

    // Parse request body
    const body = await request.json();
    const {
      offset = 0,
      limit = 10,
      itemIds,
      layerTemplate,
      collectionLayerId,
      published: requestedPublished = true,
      localeCode,
      collectionLayerClasses,
      collectionLayerTag,
    } = body;
    const published = projectScope.source === 'authenticated-preview'
      ? requestedPublished !== false
      : true;

    // Validate required fields
    if (!layerTemplate || !Array.isArray(layerTemplate)) {
      return noCache(
        { error: 'layerTemplate is required and must be an array' },
        400
      );
    }

    if (!collectionLayerId) {
      return noCache(
        { error: 'collectionLayerId is required' },
        400
      );
    }

    // Build filters
    const filters: {
      offset?: number;
      limit?: number;
      itemIds?: string[];
    } = {
      offset: isNaN(offset) ? 0 : Math.max(0, offset),
      limit: isNaN(limit) || limit < 1 ? 10 : Math.min(limit, 100), // Cap at 100
    };

    if (itemIds && Array.isArray(itemIds) && itemIds.length > 0) {
      filters.itemIds = itemIds;
    }

    // Fetch items with values
    const { items, total } = await getItemsWithValues(
      collectionId,
      published,
      filters,
      projectId
    );

    // Build collection item slugs from the items we're rendering
    const collectionItemSlugs: Record<string, string> = {};

    // Get the slug field for this collection
    const collectionFields = await getFieldsByCollectionId(collectionId, published, { excludeComputed: true }, projectId);
    const slugField = collectionFields.find(f => f.key === 'slug');

    // Extract slug values from items
    if (slugField) {
      for (const item of items) {
        if (item.values[slugField.id]) {
          collectionItemSlugs[item.id] = item.values[slugField.id];
        }
      }
    }

    // Fetch pages and folders for link resolution using repository functions
    const [pages, folders] = await Promise.all([
      getAllPages(undefined, projectId),
      getAllPageFolders(undefined, projectId),
    ]);

    // Load locale and translations if locale code is provided
    let locale = null;
    let translations: Record<string, any> | undefined;
    if (localeCode) {
      const localeData = await loadTranslationsForLocale(localeCode, published, undefined, projectId);
      locale = localeData.locale;
      translations = localeData.translations;
    }

    // Render items to HTML using the provided template
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
      projectId,
    );

    return noCache({
      data: {
        items,
        html,
        total,
        offset: filters.offset,
        limit: filters.limit,
        hasMore: (filters.offset || 0) + items.length < total,
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

/**
 * GET /ycode/api/collections/[id]/items/load-more
 * Legacy endpoint - returns raw data without rendering
 * Kept for backward compatibility
 *
 * Query params:
 * - offset: number of items to skip (default: 0)
 * - limit: number of items to fetch (default: 10)
 * - itemIds: comma-separated list of item IDs to filter by (for multi-reference fields)
 * - published: whether to fetch published items (default: true for public pages)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const projectScope = await resolvePublicContentRequestProjectScope(request);
    const projectId = projectScope.projectId;
    const { id } = await params;
    const collectionId = id;

    const { searchParams } = new URL(request.url);
    const offset = parseInt(searchParams.get('offset') || '0', 10);
    const limit = parseInt(searchParams.get('limit') || '10', 10);
    const itemIdsParam = searchParams.get('itemIds');
    const isPublished = projectScope.source === 'authenticated-preview'
      ? searchParams.get('published') !== 'false'
      : true;

    // Parse itemIds if provided (for multi-reference filtering)
    const itemIds = itemIdsParam ? itemIdsParam.split(',').filter(Boolean) : undefined;

    // Build filters
    const filters: {
      offset?: number;
      limit?: number;
      itemIds?: string[];
    } = {
      offset: isNaN(offset) ? 0 : offset,
      limit: isNaN(limit) || limit < 1 ? 10 : Math.min(limit, 100), // Cap at 100
    };

    if (itemIds && itemIds.length > 0) {
      filters.itemIds = itemIds;
    }

    // Fetch items with values
    const { items, total } = await getItemsWithValues(
      collectionId,
      isPublished,
      filters,
      projectId
    );

    return noCache({
      data: {
        items,
        total,
        offset: filters.offset,
        limit: filters.limit,
        hasMore: (filters.offset || 0) + items.length < total,
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
