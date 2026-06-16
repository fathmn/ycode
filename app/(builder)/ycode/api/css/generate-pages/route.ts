import { NextRequest, NextResponse } from 'next/server';
import { generateCSSForPage, generateCSSForPages } from '@/lib/server/cssGenerator';
import { requireStudioProjectRole, type StudioProjectRole } from '@/lib/studio-platform';

export const dynamic = 'force-dynamic';

const CSS_GENERATE_PAGE_ROLES: StudioProjectRole[] = [
  'studio_admin',
  'studio_developer',
  'customer_owner',
  'customer_editor',
];

/**
 * POST /ycode/api/css/generate-pages
 *
 * Generate per-page CSS for specific pages. Each page gets its own
 * generated_css stored on page_layers, including classes from any
 * components the page references.
 *
 * Body: { pageIds: string[] }
 */
export async function POST(request: NextRequest) {
  try {
    const roleCheck = await requireStudioProjectRole(request, CSS_GENERATE_PAGE_ROLES);
    if (!roleCheck.ok) return roleCheck.response;

    const projectId = roleCheck.context.project.id;
    const { pageIds } = await request.json();

    if (!pageIds || !Array.isArray(pageIds) || pageIds.length === 0) {
      return NextResponse.json(
        { error: 'pageIds array is required' },
        { status: 400 },
      );
    }

    if (pageIds.length === 1) {
      const css = await generateCSSForPage(pageIds[0], projectId);
      return NextResponse.json({
        data: { updated: css ? 1 : 0, length: css?.length ?? 0 },
      });
    }

    const updated = await generateCSSForPages(pageIds, projectId);
    return NextResponse.json({
      data: { updated },
    });
  } catch (error) {
    console.error('Failed to generate per-page CSS:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate CSS' },
      { status: 500 },
    );
  }
}
