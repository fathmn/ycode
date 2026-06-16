import { NextRequest, NextResponse } from 'next/server';
import { generateAndSaveDraftCSS } from '@/lib/server/cssGenerator';
import { requireStudioProjectRole, type StudioProjectRole } from '@/lib/studio-platform';

export const dynamic = 'force-dynamic';

const CSS_GENERATE_ROLES: StudioProjectRole[] = [
  'studio_admin',
  'studio_developer',
  'customer_owner',
  'customer_editor',
];

/**
 * POST /ycode/api/css/generate
 *
 * Regenerate draft CSS from all current draft layers and components.
 * Called by the MCP server after saving layers so that published
 * sites always have up-to-date CSS.
 */
export async function POST(request: NextRequest) {
  try {
    const roleCheck = await requireStudioProjectRole(request, CSS_GENERATE_ROLES);
    if (!roleCheck.ok) return roleCheck.response;

    const projectId = roleCheck.context.project.id;
    const css = await generateAndSaveDraftCSS(projectId);

    return NextResponse.json({
      data: {
        message: 'CSS generated and saved to draft_css',
        projectId,
        length: css.length,
      },
    });
  } catch (error) {
    console.error('Failed to generate CSS:', error);

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate CSS' },
      { status: 500 },
    );
  }
}
