import { NextRequest } from 'next/server';
import { getValuesByItemId } from '@/lib/repositories/collectionItemValueRepository';
import { setValuesByFieldName } from '@/lib/repositories/collectionItemValueRepository';
import { noCache } from '@/lib/api-response';
import { requireStudioProjectRole } from '@/lib/studio-platform';
import type { StudioProjectRole } from '@/lib/studio-platform';

// Disable caching for this route
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const COLLECTION_ITEM_READ_ROLES: StudioProjectRole[] = [
  'studio_admin',
  'studio_developer',
  'customer_owner',
  'customer_editor',
  'customer_viewer',
];

const COLLECTION_ITEM_WRITE_ROLES: StudioProjectRole[] = [
  'studio_admin',
  'studio_developer',
  'customer_owner',
  'customer_editor',
];

/**
 * GET /ycode/api/collections/[id]/items/[item_id]/values
 * Get all values for an item (draft version)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; item_id: string }> }
) {
  try {
    const { item_id } = await params;
    const roleCheck = await requireStudioProjectRole(request, COLLECTION_ITEM_READ_ROLES);
    if (!roleCheck.ok) return roleCheck.response;
    const projectId = roleCheck.context.project.id;

    // Always get draft values in the builder
    const values = await getValuesByItemId(item_id, false, projectId);
    return noCache({ data: values });
  } catch (error) {
    console.error('Error fetching item values:', error);
    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to fetch values' },
      500
    );
  }
}

/**
 * PUT /ycode/api/collections/[id]/items/[item_id]/values
 * Batch update values for an item (draft version)
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; item_id: string }> }
) {
  try {
    const { id, item_id } = await params;
    const roleCheck = await requireStudioProjectRole(request, COLLECTION_ITEM_WRITE_ROLES);
    if (!roleCheck.ok) return roleCheck.response;
    const projectId = roleCheck.context.project.id;

    const body = await request.json();

    if (!body || typeof body !== 'object') {
      return noCache({ error: 'Request body must be an object' }, 400);
    }

    // Set draft values by field name
    await setValuesByFieldName(
      item_id,
      id,
      body,
      {},
      false, // Update draft values
      projectId
    );

    // Get updated draft values
    const values = await getValuesByItemId(item_id, false, projectId);
    return noCache({ data: values });
  } catch (error) {
    console.error('Error updating item values:', error);
    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to update values' },
      500
    );
  }
}
