import { NextRequest } from 'next/server';
import {
  getItemWithValues,
  enrichSingleItemWithStatus,
  unpublishSingleItem,
  stageSingleItem,
  publishSingleItem,
} from '@/lib/repositories/collectionItemRepository';
import { getCollectionById } from '@/lib/repositories/collectionRepository';
import type { StatusAction } from '@/lib/collection-field-utils';
import { clearAllCache } from '@/lib/services/cacheService';
import { noCache } from '@/lib/api-response';
import { getStudioLiveMutationBlocker, requireStudioProjectRole } from '@/lib/studio-platform';
import type { StudioProjectRole } from '@/lib/studio-platform';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const COLLECTION_ITEM_WRITE_ROLES: StudioProjectRole[] = [
  'studio_admin',
  'studio_developer',
  'customer_owner',
  'customer_editor',
];

/**
 * PUT /ycode/api/collections/[id]/items/[item_id]/status
 *
 * Change an item's publish status immediately:
 * - draft:   Set is_publishable=false and remove published version + clear cache
 * - stage:   Set is_publishable=true, remove published version if exists + clear cache
 * - publish: Set is_publishable=true, copy draft to published + clear cache
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; item_id: string }> }
) {
  try {
    const { id: collectionId, item_id: itemId } = await params;
    const roleCheck = await requireStudioProjectRole(request, COLLECTION_ITEM_WRITE_ROLES);
    if (!roleCheck.ok) return roleCheck.response;
    const projectId = roleCheck.context.project.id;

    const { action } = (await request.json()) as { action: StatusAction };

    if (!['draft', 'stage', 'publish'].includes(action)) {
      return noCache({ error: 'Invalid action. Must be draft, stage, or publish' }, 400);
    }

    const blocker = getStudioLiveMutationBlocker();
    if (blocker) {
      return noCache(blocker, 409);
    }

    // Block publishing items when the collection itself hasn't been published
    if (action === 'publish') {
      const publishedCollection = await getCollectionById(collectionId, true, false, projectId);
      if (!publishedCollection) {
        return noCache(
          { error: 'Cannot publish item: the collection has not been published yet' },
          400
        );
      }
    }

    switch (action) {
      case 'draft':
        await unpublishSingleItem(itemId, projectId);
        await clearAllCache();
        break;

      case 'stage': {
        const hadPublished = await stageSingleItem(itemId, projectId);
        if (hadPublished) await clearAllCache();
        break;
      }

      case 'publish':
        await publishSingleItem(itemId, projectId);
        await clearAllCache();
        break;
    }

    // Return enriched item
    const item = await getItemWithValues(itemId, false, projectId);
    if (item) {
      await enrichSingleItemWithStatus(item, collectionId, projectId);
    }

    return noCache({ data: item });
  } catch (error) {
    console.error('Error updating item status:', error);
    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to update item status' },
      500
    );
  }
}
