import { NextRequest, NextResponse } from 'next/server';
import { getUnpublishedPages } from '@/lib/repositories/pageRepository';
import { noCache } from '@/lib/api-response';
import { requireStudioProjectRole } from '@/lib/studio-platform';

// Disable caching for this route
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /ycode/api/pages/unpublished
 * Get all unpublished pages
 */
export async function GET(request: NextRequest) {
  try {
    const roleCheck = await requireStudioProjectRole(request, [
      'studio_admin',
      'studio_developer',
      'customer_owner',
      'customer_editor',
      'customer_viewer',
    ]);
    if (!roleCheck.ok) return roleCheck.response;

    const pages = await getUnpublishedPages(roleCheck.context.project.id);
    
    return noCache({ data: pages });
  } catch (error) {
    console.error('Error fetching unpublished pages:', error);
    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to fetch unpublished pages' },
      500
    );
  }
}
