import { NextRequest, NextResponse } from 'next/server';
import { getCollectionById, updateCollection, deleteCollection } from '@/lib/repositories/collectionRepository';
import { getItemsByCollectionId } from '@/lib/repositories/collectionItemRepository';
import { deleteTranslationsInBulk } from '@/lib/repositories/translationRepository';
import { noCache } from '@/lib/api-response';
import { requireStudioProjectRole, type StudioProjectRole } from '@/lib/studio-platform';
import { recordInStudioProject } from '@/lib/project-scope';

const STUDIO_READ_ROLES: StudioProjectRole[] = [
  'studio_admin',
  'studio_developer',
  'customer_owner',
  'customer_editor',
  'customer_viewer',
];
const STUDIO_WRITE_ROLES: StudioProjectRole[] = [
  'studio_admin',
  'studio_developer',
  'customer_owner',
  'customer_editor',
];

// Disable caching for this route
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /ycode/api/collections/[id]
 * Get collection by ID (draft version)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const roleCheck = await requireStudioProjectRole(request, STUDIO_READ_ROLES);
    if (!roleCheck.ok) return roleCheck.response;
    const projectId = roleCheck.context.project.id;

    const { id } = await params;

    // Always get draft version in the builder
    const collection = await getCollectionById(id, false);

    if (!collection || !recordInStudioProject(collection, projectId)) {
      return noCache({ error: 'Collection not found' }, 404);
    }

    return noCache({ data: collection });
  } catch (error) {
    console.error('Error fetching collection:', error);
    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to fetch collection' },
      500
    );
  }
}

/**
 * PUT /ycode/api/collections/[id]
 * Update collection (draft version)
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const roleCheck = await requireStudioProjectRole(request, STUDIO_WRITE_ROLES);
    if (!roleCheck.ok) return roleCheck.response;
    const projectId = roleCheck.context.project.id;

    const { id } = await params;

    const body = await request.json();

    const existing = await getCollectionById(id, false);
    if (!existing || !recordInStudioProject(existing, projectId)) {
      return noCache({ error: 'Collection not found' }, 404);
    }

    // Always update draft version in the builder
    const collection = await updateCollection(id, body, false);

    return noCache({ data: collection });
  } catch (error) {
    console.error('Error updating collection:', error);
    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to update collection' },
      500
    );
  }
}

/**
 * DELETE /ycode/api/collections/[id]
 * Delete collection (soft delete draft version) and all associated translations
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const roleCheck = await requireStudioProjectRole(request, STUDIO_WRITE_ROLES);
    if (!roleCheck.ok) return roleCheck.response;
    const projectId = roleCheck.context.project.id;

    const { id } = await params;

    const existing = await getCollectionById(id, false);
    if (!existing || !recordInStudioProject(existing, projectId)) {
      return noCache({ error: 'Collection not found' }, 404);
    }

    // Get all items in this collection (draft versions)
    const { items } = await getItemsByCollectionId(id, false);

    // Delete translations for all items in this collection in a single query
    if (items.length > 0) {
      const itemIds = items.map(item => item.id);
      await deleteTranslationsInBulk('cms', itemIds);
    }

    // Delete the collection (soft delete draft version)
    await deleteCollection(id, false);

    return noCache({ data: { success: true } });
  } catch (error) {
    console.error('Error deleting collection:', error);
    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to delete collection' },
      500
    );
  }
}
