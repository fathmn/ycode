import { NextRequest } from 'next/server';
import {
  getAllColorVariables,
  createColorVariable,
} from '@/lib/repositories/colorVariableRepository';
import { noCache } from '@/lib/api-response';
import { requireStudioProjectRole, type StudioProjectRole } from '@/lib/studio-platform';

const COLOR_VARIABLE_READ_ROLES: StudioProjectRole[] = [
  'studio_admin',
  'studio_developer',
  'customer_owner',
  'customer_editor',
  'customer_viewer',
];

const COLOR_VARIABLE_WRITE_ROLES: StudioProjectRole[] = [
  'studio_admin',
  'studio_developer',
  'customer_owner',
  'customer_editor',
];

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /ycode/api/color-variables
 */
export async function GET(request: NextRequest) {
  try {
    const roleCheck = await requireStudioProjectRole(request, COLOR_VARIABLE_READ_ROLES);
    if (!roleCheck.ok) return roleCheck.response;

    const variables = await getAllColorVariables(roleCheck.context.project.id);

    return noCache({ data: variables });
  } catch (error) {
    console.error('[GET /ycode/api/color-variables] Error:', error);

    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to fetch color variables' },
      500
    );
  }
}

/**
 * POST /ycode/api/color-variables
 */
export async function POST(request: NextRequest) {
  try {
    const roleCheck = await requireStudioProjectRole(request, COLOR_VARIABLE_WRITE_ROLES);
    if (!roleCheck.ok) return roleCheck.response;

    const body = await request.json();
    const { name, value } = body;

    if (!name || !value) {
      return noCache(
        { error: 'Name and value are required' },
        400
      );
    }

    const variable = await createColorVariable({ name, value, projectId: roleCheck.context.project.id });

    return noCache({ data: variable });
  } catch (error) {
    console.error('[POST /ycode/api/color-variables] Error:', error);

    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to create color variable' },
      500
    );
  }
}
