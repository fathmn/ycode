import { NextRequest, NextResponse } from 'next/server';
import { getAllFields } from '@/lib/repositories/collectionFieldRepository';
import { noCache } from '@/lib/api-response';
import { resolveStudioProjectId } from '@/lib/project-scope';

// Disable caching for this route
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /ycode/api/collections/fields
 * Get all fields for all collections (draft version)
 */
export async function GET(request: NextRequest) {
  try {
    const projectSlug = request.headers.get('x-studio-project-slug');
    const projectId = projectSlug ? await resolveStudioProjectId(projectSlug) : null;
    if (!projectSlug || !projectId) {
      return noCache({ error: 'Invalid project' }, 404);
    }

    // Always get draft fields in the builder
    const fields = await getAllFields(false, projectId);

    return noCache({ data: fields });
  } catch (error) {
    console.error('Error fetching all collection fields:', error);
    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to fetch fields' },
      500
    );
  }
}
