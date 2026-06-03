import { NextRequest } from 'next/server';
import {
  updateColorVariable,
  deleteColorVariable,
} from '@/lib/repositories/colorVariableRepository';
import { noCache } from '@/lib/api-response';
import { requireStudioProjectRole, type StudioProjectRole } from '@/lib/studio-platform';

const COLOR_VARIABLE_WRITE_ROLES: StudioProjectRole[] = [
  'studio_admin',
  'studio_developer',
  'customer_owner',
  'customer_editor',
];

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * PUT /ycode/api/color-variables/[id]
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const roleCheck = await requireStudioProjectRole(request, COLOR_VARIABLE_WRITE_ROLES);
    if (!roleCheck.ok) return roleCheck.response;

    const { id } = await params;
    const body = await request.json();

    const updated = await updateColorVariable(id, body, roleCheck.context.project.id);

    return noCache({ data: updated });
  } catch (error) {
    console.error('[PUT /ycode/api/color-variables/[id]] Error:', error);

    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to update color variable' },
      500
    );
  }
}

/**
 * DELETE /ycode/api/color-variables/[id]
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const roleCheck = await requireStudioProjectRole(request, COLOR_VARIABLE_WRITE_ROLES);
    if (!roleCheck.ok) return roleCheck.response;

    const { id } = await params;

    await deleteColorVariable(id, roleCheck.context.project.id);

    return noCache({ data: { success: true } });
  } catch (error) {
    console.error('[DELETE /ycode/api/color-variables/[id]] Error:', error);

    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to delete color variable' },
      500
    );
  }
}
