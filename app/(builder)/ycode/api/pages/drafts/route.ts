import { NextRequest, NextResponse } from 'next/server';
import { getAllDraftLayers } from '@/lib/repositories/pageLayersRepository';
import { requireStudioProjectRole } from '@/lib/studio-platform';

/**
 * GET /ycode/api/pages/drafts
 * Get all draft (non-published) page layers in one query
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

    const drafts = await getAllDraftLayers(roleCheck.context.project.id);

    return NextResponse.json({ data: drafts });
  } catch (error) {
    console.error('Error fetching drafts:', error);
    return NextResponse.json(
      { error: 'Failed to fetch drafts' },
      { status: 500 }
    );
  }
}
