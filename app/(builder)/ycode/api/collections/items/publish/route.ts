import { NextRequest } from 'next/server';
import { hardDeleteItem, getItemById, publishSingleItem } from '@/lib/repositories/collectionItemRepository';
import { getCollectionById } from '@/lib/repositories/collectionRepository';
import { cleanupDeletedCollections } from '@/lib/services/collectionService';
import { noCache } from '@/lib/api-response';
import { getStudioLiveMutationBlocker, requireStudioProjectRole } from '@/lib/studio-platform';
import type { StudioProjectRole } from '@/lib/studio-platform';

// Disable caching for this route
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const COLLECTION_ITEM_WRITE_ROLES: StudioProjectRole[] = [
  'studio_admin',
  'studio_developer',
  'customer_owner',
  'customer_editor',
];

/**
 * POST /ycode/api/collections/items/publish
 * Publish individual collection items by their IDs
 * - For normal items: Copies draft values to published values
 * - For deleted items (deleted_at set): Hard deletes the item and all values
 */
export async function POST(request: NextRequest) {
  try {
    const roleCheck = await requireStudioProjectRole(request, COLLECTION_ITEM_WRITE_ROLES);
    if (!roleCheck.ok) return roleCheck.response;
    const projectId = roleCheck.context.project.id;

    const blocker = getStudioLiveMutationBlocker();
    if (blocker) {
      return noCache(blocker, 409);
    }

    const body = await request.json();
    const { item_ids } = body;
    
    if (!Array.isArray(item_ids)) {
      return noCache({ error: 'item_ids must be an array' }, 400);
    }
    
    let publishedCount = 0;
    
    // Publish each item
    for (const itemId of item_ids) {
      try {
        // Check if item is marked as deleted
        const item = await getItemById(itemId, false, projectId);
        
        if (!item) {
          continue; // Item doesn't exist
        }
        
        if (item.deleted_at) {
          // Hard delete the item and all its values (CASCADE)
          await hardDeleteItem(itemId, false, projectId);
          publishedCount++;
        } else {
          // Block publishing if the collection hasn't been published
          const publishedCollection = await getCollectionById(item.collection_id, true, false, projectId);
          if (!publishedCollection) {
            console.warn(`Skipping item ${itemId}: collection ${item.collection_id} is not published`);
            continue;
          }
          // Normal publish: create/update published item row and copy draft values.
          await publishSingleItem(itemId, projectId);
          publishedCount++;
        }
      } catch (error) {
        console.error(`Error publishing item ${itemId}:`, error);
        // Continue with other items
      }
    }
    
    // Clean up any soft-deleted collections
    await cleanupDeletedCollections(projectId);
    
    return noCache({ 
      data: { count: publishedCount } 
    });
  } catch (error) {
    console.error('Error publishing collection items:', error);
    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to publish items' },
      500
    );
  }
}
