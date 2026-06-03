import { NextRequest } from 'next/server';
import { deleteItem } from '@/lib/repositories/collectionItemRepository';
import { noCache } from '@/lib/api-response';
import { requireStudioProjectRole } from '@/lib/studio-platform';
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
 * POST /ycode/api/collections/items/delete
 * Bulk delete collection items by their IDs (soft delete)
 * Sets deleted_at timestamp to mark items as deleted in draft
 */
export async function POST(request: NextRequest) {
  try {
    const roleCheck = await requireStudioProjectRole(request, COLLECTION_ITEM_WRITE_ROLES);
    if (!roleCheck.ok) return roleCheck.response;
    const projectId = roleCheck.context.project.id;

    const body = await request.json();
    const { item_ids } = body;
    
    if (!Array.isArray(item_ids)) {
      return noCache({ error: 'item_ids must be an array' }, 400);
    }
    
    if (item_ids.length === 0) {
      return noCache({ error: 'item_ids cannot be empty' }, 400);
    }
    
    let deletedCount = 0;
    const errors: string[] = [];
    
    // Delete each item
    for (const itemId of item_ids) {
      try {
        await deleteItem(itemId, false, projectId);
        deletedCount++;
      } catch (error) {
        console.error(`Error deleting item ${itemId}:`, error);
        errors.push(`Failed to delete item ${itemId}`);
        // Continue with other items
      }
    }
    
    return noCache({ 
      data: { 
        deleted: deletedCount,
        errors: errors.length > 0 ? errors : undefined
      } 
    });
  } catch (error) {
    console.error('Error bulk deleting collection items:', error);
    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to delete items' },
      500
    );
  }
}
