import { NextRequest } from 'next/server';
import { deletePageFolder, updatePageFolder, getPageFolderById } from '@/lib/repositories/pageFolderRepository';
import { deleteTranslationsInBulk } from '@/lib/repositories/translationRepository';
import { noCache } from '@/lib/api-response';
import { requireStudioProjectRole, type StudioProjectRole } from '@/lib/studio-platform';

// Disable caching for this route
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const FOLDER_READ_ROLES: StudioProjectRole[] = [
  'studio_admin',
  'studio_developer',
  'customer_owner',
  'customer_editor',
  'customer_viewer',
];

const FOLDER_WRITE_ROLES: StudioProjectRole[] = [
  'studio_admin',
  'studio_developer',
  'customer_owner',
  'customer_editor',
];

/**
 * GET /ycode/api/folders/[id]
 *
 * Get a folder by ID
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const roleCheck = await requireStudioProjectRole(request, FOLDER_READ_ROLES);
    if (!roleCheck.ok) return roleCheck.response;
    const projectId = roleCheck.context.project.id;

    const { id } = await params;

    const folder = await getPageFolderById(id, false, projectId);

    if (!folder) {
      return noCache(
        { error: 'Folder not found' },
        404
      );
    }

    return noCache(
      { data: folder },
      200
    );
  } catch (error) {
    console.error('[GET /ycode/api/folders/[id]] Error:', error);

    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to fetch folder' },
      500
    );
  }
}

/**
 * PUT /ycode/api/folders/[id]
 *
 * Update a folder
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const roleCheck = await requireStudioProjectRole(request, FOLDER_WRITE_ROLES);
    if (!roleCheck.ok) return roleCheck.response;
    const projectId = roleCheck.context.project.id;

    const { id } = await params;
    const body = await request.json();
    delete body.is_published;

    // Validate required fields if provided
    if (body.name !== undefined && typeof body.name !== 'string') {
      return noCache(
        { error: 'Invalid name field' },
        400
      );
    }

    if (body.slug !== undefined && typeof body.slug !== 'string') {
      return noCache(
        { error: 'Invalid slug field' },
        400
      );
    }

    const updatedFolder = await updatePageFolder(id, body, projectId);

    return noCache(
      { data: updatedFolder },
      200
    );
  } catch (error) {
    console.error('[PUT /ycode/api/folders/[id]] Error:', error);

    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to update folder' },
      500
    );
  }
}

/**
 * DELETE /ycode/api/folders/[id]
 *
 * Delete a folder and its associated translations (soft delete)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const roleCheck = await requireStudioProjectRole(request, FOLDER_WRITE_ROLES);
    if (!roleCheck.ok) return roleCheck.response;
    const projectId = roleCheck.context.project.id;

    const { id } = await params;

    // Delete the folder
    await deletePageFolder(id, projectId);
    
    // Delete all translations for this folder
    await deleteTranslationsInBulk('folder', id);

    return noCache(
      { data: { success: true } },
      200
    );
  } catch (error) {
    console.error('[DELETE /ycode/api/folders/[id]] Error:', error);

    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to delete folder' },
      500
    );
  }
}
