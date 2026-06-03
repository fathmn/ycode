import { NextRequest } from 'next/server';
import { getUnpublishedPagesCount } from '@/lib/repositories/pageRepository';
import { getTotalPublishableItemsCount } from '@/lib/repositories/collectionItemRepository';
import { getUnpublishedCollections } from '@/lib/repositories/collectionRepository';
import { getUnpublishedComponents } from '@/lib/repositories/componentRepository';
import { getUnpublishedLayerStyles } from '@/lib/repositories/layerStyleRepository';
import { getUnpublishedAssets } from '@/lib/repositories/assetRepository';
import { getDeletedDraftCount } from '@/lib/sync-utils';
import { noCache } from '@/lib/api-response';
import { requireStudioProjectRole, type StudioProjectRole } from '@/lib/studio-platform';

// Disable caching for this route
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export interface PublishPreviewCounts {
  pages: number;
  collections: number;
  collectionItems: number;
  components: number;
  layerStyles: number;
  assets: number;
  total: number;
}

const PUBLISH_PREVIEW_ROLES: StudioProjectRole[] = [
  'studio_admin',
  'studio_developer',
  'customer_owner',
  'customer_editor',
  'customer_viewer',
];

/**
 * GET /ycode/api/publish/preview
 * Count all pending changes (new, modified, deleted) per entity type.
 */
export async function GET(request: NextRequest) {
  try {
    const roleCheck = await requireStudioProjectRole(request, PUBLISH_PREVIEW_ROLES);
    if (!roleCheck.ok) return roleCheck.response;
    const projectId = roleCheck.context.project.id;

    // Count changed + deleted in parallel for each entity type
    const [
      pagesChanged, pagesDeleted,
      collectionsChanged, collectionsDeleted,
      itemsChanged, itemsDeleted,
      componentsChanged, componentsDeleted,
      layerStylesChanged, layerStylesDeleted,
      assetsChanged, assetsDeleted,
    ] = await Promise.all([
      getUnpublishedPagesCount(projectId),
      getDeletedDraftCount('pages', projectId),
      getUnpublishedCollections(projectId).then(c => c.length),
      getDeletedDraftCount('collections', projectId),
      getTotalPublishableItemsCount(projectId),
      getDeletedDraftCount('collection_items', projectId),
      getUnpublishedComponents(projectId).then(c => c.length),
      getDeletedDraftCount('components', projectId),
      getUnpublishedLayerStyles(projectId).then(s => s.length),
      getDeletedDraftCount('layer_styles', projectId),
      getUnpublishedAssets(projectId).then(a => a.length),
      getDeletedDraftCount('assets', projectId),
    ]);

    const pages = pagesChanged + pagesDeleted;
    const collections = collectionsChanged + collectionsDeleted;
    const collectionItems = itemsChanged + itemsDeleted;
    const components = componentsChanged + componentsDeleted;
    const layerStyles = layerStylesChanged + layerStylesDeleted;
    const assets = assetsChanged + assetsDeleted;
    const total = pages + collections + collectionItems + components + layerStyles + assets;

    return noCache({
      data: { pages, collections, collectionItems, components, layerStyles, assets, total } satisfies PublishPreviewCounts,
    });
  } catch (error) {
    console.error('Error fetching publish preview:', error);
    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to fetch publish preview' },
      500
    );
  }
}
