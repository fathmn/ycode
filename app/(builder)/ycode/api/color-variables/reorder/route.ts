import { NextRequest } from 'next/server';
import { reorderColorVariables } from '@/lib/repositories/colorVariableRepository';
import { noCache } from '@/lib/api-response';
import { requireStudioProjectRole, type StudioProjectRole } from '@/lib/studio-platform';

const COLOR_VARIABLE_WRITE_ROLES: StudioProjectRole[] = [
  'studio_admin',
  'studio_developer',
  'customer_owner',
  'customer_editor',
];

export async function PUT(request: NextRequest) {
  try {
    const roleCheck = await requireStudioProjectRole(request, COLOR_VARIABLE_WRITE_ROLES);
    if (!roleCheck.ok) return roleCheck.response;

    const body = await request.json();
    const { orderedIds } = body;

    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
      return noCache({ error: 'orderedIds array is required' }, 400);
    }

    await reorderColorVariables(orderedIds, roleCheck.context.project.id);
    return noCache({ data: { success: true } });
  } catch (error) {
    console.error('Error reordering color variables:', error);
    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to reorder color variables' },
      500
    );
  }
}
