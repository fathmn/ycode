import { NextRequest } from 'next/server';
import { duplicatePage } from '@/lib/repositories/pageRepository';
import { noCache } from '@/lib/api-response';
import { requireStudioProjectRole } from '@/lib/studio-platform';

// Disable caching for this route
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * POST /ycode/api/pages/[id]/duplicate
 *
 * Duplicate a page with its draft layers
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const roleCheck = await requireStudioProjectRole(request, [
      'studio_admin',
      'studio_developer',
      'customer_owner',
      'customer_editor',
    ]);
    if (!roleCheck.ok) return roleCheck.response;

    const newPage = await duplicatePage(id, roleCheck.context.project.id);

    return noCache(
      { data: newPage },
      201
    );
  } catch (error) {
    console.error('[POST /ycode/api/pages/[id]/duplicate] Error:', error);

    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to duplicate page' },
      500
    );
  }
}
