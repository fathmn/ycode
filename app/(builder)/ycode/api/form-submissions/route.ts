import { NextRequest, NextResponse } from 'next/server';
import {
  getAllFormSubmissions,
  getFormSummaries,
  createFormSubmission,
  deleteFormSubmissionsByFormId,
  bulkDeleteFormSubmissions,
  hasDefinedFormId,
} from '@/lib/repositories/formSubmissionRepository';
import { dispatchFormSubmittedEvent } from '@/lib/services/webhookService';
import { sendFormSubmissionEmail, extractReplyToEmail } from '@/lib/services/emailService';
import { processAppIntegrations } from '@/lib/apps/integration-service';
import { noCache } from '@/lib/api-response';
import { resolvePublicFormSubmissionProjectScope } from '@/lib/request-project-scope';
import { requireNovumProjectRole, type NovumRole } from '@/lib/novum-platform';

// Disable caching for this route
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const FORM_READ_ROLES: NovumRole[] = [
  'novum_admin',
  'novum_developer',
  'customer_owner',
  'customer_editor',
  'customer_viewer',
];

const FORM_WRITE_ROLES: NovumRole[] = [
  'novum_admin',
  'novum_developer',
  'customer_owner',
  'customer_editor',
];

async function requireFormProjectId(request: NextRequest, roles: NovumRole[]) {
  const roleCheck = await requireNovumProjectRole(request, roles);
  if (!roleCheck.ok) return roleCheck;
  return { ok: true as const, projectId: roleCheck.context.project.id };
}

/**
 * GET /ycode/api/form-submissions
 * Get all form submissions or form summaries
 *
 * Query params:
 * - form_id: Filter by form ID
 * - status: Filter by status
 * - summary: If 'true', returns form summaries instead of submissions
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const formId = searchParams.get('form_id') || undefined;
    const status = searchParams.get('status') as 'new' | 'read' | 'archived' | 'spam' | undefined;
    const summary = searchParams.get('summary') === 'true';
    const access = await requireFormProjectId(request, FORM_READ_ROLES);
    if (!access.ok) return access.response;
    const projectId = access.projectId;

    if (summary) {
      const summaries = await getFormSummaries(projectId);
      return noCache({ data: summaries });
    }

    const submissions = await getAllFormSubmissions(formId, status, projectId);
    return noCache({ data: submissions });
  } catch (error) {
    console.error('Error fetching form submissions:', error);
    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to fetch form submissions' },
      500
    );
  }
}

/**
 * POST /ycode/api/form-submissions
 * Create a new form submission (public endpoint for form submissions)
 *
 * Body:
 * - form_id: string (required)
 * - payload: object (required)
 * - metadata: object (optional - IP, user agent, etc.)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate required fields
    if (!body.form_id) {
      return NextResponse.json(
        { error: 'Missing required field: form_id' },
        { status: 400 }
      );
    }

    if (!body.payload || typeof body.payload !== 'object') {
      return NextResponse.json(
        { error: 'Missing or invalid field: payload' },
        { status: 400 }
      );
    }

    // Extract metadata from request if not provided
    const metadata = body.metadata || {
      user_agent: request.headers.get('user-agent') || undefined,
      referrer: request.headers.get('referer') || undefined,
      // Note: IP is typically handled by the proxy/edge, not available directly
    };
    const projectScope = await resolvePublicFormSubmissionProjectScope(request);
    const projectId = projectScope.projectId;
    const isPublishedDefinition = projectScope.definitionState === 'any'
      ? undefined
      : projectScope.definitionState === 'published';
    if (projectId && !(await hasDefinedFormId(body.form_id, projectId, isPublishedDefinition))) {
      return NextResponse.json(
        { error: 'Form is not available for this project' },
        { status: 404 }
      );
    }

    const submission = await createFormSubmission({
      form_id: body.form_id,
      payload: body.payload,
      metadata,
    }, projectId);

    // Dispatch webhook event (fire and forget)
    dispatchFormSubmittedEvent({
      form_id: body.form_id,
      submission_id: submission.id,
      fields: body.payload,
      projectId,
      metadata,
    });

    // Send email notification if enabled (fire and forget)
    if (body.email?.enabled && body.email?.to) {
      // Extract reply-to email from form payload (first email field found)
      const replyTo = extractReplyToEmail(body.payload);

      sendFormSubmissionEmail(
        body.email.to,
        body.email.subject || `New form submission: ${body.form_id}`,
        {
          formId: body.form_id,
          submissionId: submission.id,
          payload: body.payload,
          metadata: {
            ...metadata,
            submitted_at: submission.created_at,
          },
          replyTo,
        }
      );
    }

    // Process app integrations (fire and forget)
    processAppIntegrations(body.form_id, submission.id, body.payload, projectId);

    return NextResponse.json(
      { data: submission, message: 'Form submitted successfully' },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error creating form submission:', error);
    if (error instanceof Error && error.message === 'Not authorized for requested preview project') {
      return NextResponse.json(
        { error: error.message },
        { status: 403 }
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to submit form' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /ycode/api/form-submissions
 * Delete submissions - either by form_id (all submissions) or by ids (bulk delete)
 *
 * Query params:
 * - form_id: string - Delete all submissions for this form
 *
 * OR Body:
 * - ids: string[] - Array of submission IDs to delete
 */
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const formId = searchParams.get('form_id');

    // If form_id is provided, delete all submissions for that form
    const access = await requireFormProjectId(request, FORM_WRITE_ROLES);
    if (!access.ok) return access.response;
    const projectId = access.projectId;
    if (formId) {
      await deleteFormSubmissionsByFormId(formId, projectId);
      return noCache({ message: 'All submissions for form deleted successfully' });
    }

    // Otherwise, try to parse body for bulk delete
    const body = await request.json().catch(() => ({}));
    const ids = body.ids;

    if (Array.isArray(ids) && ids.length > 0) {
      await bulkDeleteFormSubmissions(ids, projectId);
      return noCache({ message: `${ids.length} submissions deleted successfully` });
    }

    return noCache({ error: 'Missing required param: form_id or ids in body' }, 400);
  } catch (error) {
    console.error('Error deleting form submissions:', error);
    if (error instanceof Error && error.message === 'Not authenticated') {
      return noCache({ error: 'Not authenticated' }, 401);
    }
    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to delete form submissions' },
      500
    );
  }
}
