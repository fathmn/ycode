import { NextRequest } from 'next/server';
import { publishCollectionWithItems, cleanupDeletedCollections } from '@/lib/services/collectionService';
import { noCache } from '@/lib/api-response';
import { getStudioLiveMutationBlocker, requireStudioProjectRole } from '@/lib/studio-platform';
import type { StudioProjectRole } from '@/lib/studio-platform';

// Disable caching for this route
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const COLLECTION_PUBLISH_ROLES: StudioProjectRole[] = [
  'studio_admin',
  'studio_developer',
  'customer_owner',
];

/**
 * POST /ycode/api/collections/[id]/publish
 * Publish a single collection with optional item selection
 * 
 * Body: {
 *   itemIds?: string[]; // Optional: specific items to publish
 * }
 * 
 * Response: {
 *   data: {
 *     success: boolean;
 *     published: {
 *       collection: boolean;
 *       fieldsCount: number;
 *       itemsCount: number;
 *       valuesCount: number;
 *     };
 *     errors?: string[];
 *   }
 * }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const roleCheck = await requireStudioProjectRole(request, COLLECTION_PUBLISH_ROLES);
    if (!roleCheck.ok) return roleCheck.response;
    const projectId = roleCheck.context.project.id;

    const blocker = getStudioLiveMutationBlocker();
    if (blocker) {
      return noCache(blocker, 409);
    }

    const { id } = await params;
    const collectionId = id;
    
    // Parse request body
    const body = await request.json().catch(() => ({}));
    const { itemIds } = body;
    
    // Validate itemIds if provided
    if (itemIds !== undefined && !Array.isArray(itemIds)) {
      return noCache({ error: 'itemIds must be an array' }, 400);
    }
    
    // Publish the collection
    const result = await publishCollectionWithItems({
      collectionId,
      itemIds,
      projectId,
    });
    
    // Clean up any soft-deleted collections
    await cleanupDeletedCollections(projectId);
    
    // Return appropriate status based on result
    if (result.success) {
      return noCache({ data: result });
    } else {
      return noCache(
        { 
          error: result.errors?.[0] || 'Failed to publish collection',
          details: result 
        },
        500
      );
    }
  } catch (error) {
    console.error('Error in publish endpoint:', error);
    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to publish collection' },
      500
    );
  }
}
