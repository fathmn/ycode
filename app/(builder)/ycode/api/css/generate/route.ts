import { NextResponse } from 'next/server';
import { generateAndSaveDraftCSS } from '@/lib/server/cssGenerator';

export const dynamic = 'force-dynamic';

/**
 * POST /ycode/api/css/generate
 *
 * Regenerate draft CSS from all current draft layers and components.
 * Called by the MCP server after saving layers so that published
 * sites always have up-to-date CSS.
 */
export async function POST(request: Request) {
  try {
    let projectId: string | null = null;
    try {
      const body = await request.json();
      projectId = typeof body?.projectId === 'string' ? body.projectId : null;
    } catch {
      projectId = null;
    }

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
