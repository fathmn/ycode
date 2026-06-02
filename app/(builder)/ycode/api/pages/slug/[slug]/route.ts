import { NextRequest, NextResponse } from 'next/server';
import { getPageBySlug } from '@/lib/repositories/pageRepository';
import { noCache } from '@/lib/api-response';
import { requireStudioProjectRole } from '@/lib/studio-platform';

/**
 * GET /ycode/api/pages/slug/[slug]
 *
 * Get a page by slug
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const roleCheck = await requireStudioProjectRole(request, [
      'studio_admin',
      'studio_developer',
      'customer_owner',
      'customer_editor',
      'customer_viewer',
    ]);
    if (!roleCheck.ok) return roleCheck.response;

    const page = await getPageBySlug(slug, undefined, roleCheck.context.project.id);

    if (!page) {
      return noCache(
        { error: 'Page not found' },
        404
      );
    }

    return noCache({
      data: page,
    });
  } catch (error) {
    console.error('Failed to fetch page:', error);

    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to fetch page' },
      500
    );
  }
}
