import { NextRequest } from 'next/server';
import {
  getFormSubmissionById,
  updateFormSubmission,
  deleteFormSubmission,
} from '@/lib/repositories/formSubmissionRepository';
import { noCache } from '@/lib/api-response';
import { requireStudioProjectRole, type StudioProjectRole } from '@/lib/studio-platform';

// Disable caching for this route
export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface RouteParams {
  params: Promise<{ id: string }>;
}

const FORM_READ_ROLES: StudioProjectRole[] = [
  'studio_admin',
  'studio_developer',
  'customer_owner',
  'customer_editor',
  'customer_viewer',
];

const FORM_WRITE_ROLES: StudioProjectRole[] = [
  'studio_admin',
  'studio_developer',
  'customer_owner',
  'customer_editor',
];

async function requireFormProjectId(request: NextRequest, roles: StudioProjectRole[]) {
  const roleCheck = await requireStudioProjectRole(request, roles);
  if (!roleCheck.ok) return roleCheck;
  return { ok: true as const, projectId: roleCheck.context.project.id };
}

/**
 * GET /ycode/api/form-submissions/[id]
 * Get a single form submission by ID
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const access = await requireFormProjectId(request, FORM_READ_ROLES);
    if (!access.ok) return access.response;
    const projectId = access.projectId;
    const submission = await getFormSubmissionById(id, projectId);

    if (!submission) {
      return noCache({ error: 'Form submission not found' }, 404);
    }

    return noCache({ data: submission });
  } catch (error) {
    console.error('Error fetching form submission:', error);
    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to fetch form submission' },
      500
    );
  }
}

/**
 * PUT /ycode/api/form-submissions/[id]
 * Update a form submission (e.g., change status)
 *
 * Body:
 * - status: 'new' | 'read' | 'archived' | 'spam'
 */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body = await request.json();
    const access = await requireFormProjectId(request, FORM_WRITE_ROLES);
    if (!access.ok) return access.response;
    const projectId = access.projectId;

    // Validate status if provided
    if (body.status && !['new', 'read', 'archived', 'spam'].includes(body.status)) {
      return noCache({ error: 'Invalid status value' }, 400);
    }

    const submission = await updateFormSubmission(id, {
      status: body.status,
    }, projectId);

    return noCache({ data: submission });
  } catch (error) {
    console.error('Error updating form submission:', error);
    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to update form submission' },
      500
    );
  }
}

/**
 * DELETE /ycode/api/form-submissions/[id]
 * Delete a form submission
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const access = await requireFormProjectId(request, FORM_WRITE_ROLES);
    if (!access.ok) return access.response;
    const projectId = access.projectId;
    await deleteFormSubmission(id, projectId);

    return noCache({ message: 'Form submission deleted successfully' });
  } catch (error) {
    console.error('Error deleting form submission:', error);
    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to delete form submission' },
      500
    );
  }
}
