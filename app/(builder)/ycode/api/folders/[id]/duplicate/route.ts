import { NextRequest } from 'next/server';
import { duplicatePageFolder } from '@/lib/repositories/pageFolderRepository';
import { noCache } from '@/lib/api-response';
import { requireStudioProjectRole, type StudioProjectRole } from '@/lib/studio-platform';

// Disable caching for this route
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const FOLDER_WRITE_ROLES: StudioProjectRole[] = [
  'studio_admin',
  'studio_developer',
  'customer_owner',
  'customer_editor',
];

/**
 * POST /ycode/api/folders/[id]/duplicate
 *
 * Duplicate a folder
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const roleCheck = await requireStudioProjectRole(request, FOLDER_WRITE_ROLES);
    if (!roleCheck.ok) return roleCheck.response;
    const projectId = roleCheck.context.project.id;

    const { id } = await params;

    const newFolder = await duplicatePageFolder(id, projectId);

    return noCache(
      { data: newFolder },
      201
    );
  } catch (error) {
    console.error('[POST /ycode/api/folders/[id]/duplicate] Error:', error);

    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to duplicate folder' },
      500
    );
  }
}
