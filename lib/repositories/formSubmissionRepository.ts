import { getSupabaseAdmin } from '@/lib/supabase-server';
import { applyProjectScopeToQuery } from '@/lib/project-scope';
import type {
  Layer,
  FormSubmission,
  FormSummary,
  CreateFormSubmissionData,
  UpdateFormSubmissionData,
  FormSubmissionStatus,
} from '@/types';

/**
 * Form Submission Repository
 *
 * Handles CRUD operations for form submissions.
 * Uses Supabase/PostgreSQL via admin client.
 */

/**
 * Get all form submissions, optionally filtered by form_id
 */
export async function getAllFormSubmissions(
  formId?: string,
  status?: FormSubmissionStatus,
  _projectId?: string | null
): Promise<FormSubmission[]> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase client not configured');
  }

  let query = client
    .from('form_submissions')
    .select('*')
    .order('created_at', { ascending: false });

  if (formId) {
    query = query.eq('form_id', formId);
  }

  if (status) {
    query = query.eq('status', status);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to fetch form submissions: ${error.message}`);
  }

  return data || [];
}

/**
 * Get form submission by ID
 */
export async function getFormSubmissionById(id: string): Promise<FormSubmission | null> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase client not configured');
  }

  const { data, error } = await client
    .from('form_submissions')
    .select('*')
    .eq('id', id)
    .single();

  if (error && error.code !== 'PGRST116') {
    throw new Error(`Failed to fetch form submission: ${error.message}`);
  }

  return data;
}

/**
 * Get all unique forms with submission counts
 */
function collectFormIdsFromLayers(layers: Layer[] | unknown, formIds: Set<string>): void {
  if (!Array.isArray(layers)) return;

  for (const layer of layers as Layer[]) {
    if (!layer || typeof layer !== 'object') continue;
    if (layer.name === 'form') {
      const configuredId = typeof layer.settings?.id === 'string'
        ? layer.settings.id.trim()
        : '';
      formIds.add(configuredId || 'unnamed-form');
    }
    collectFormIdsFromLayers(layer.children, formIds);
  }
}

async function getDefinedFormIds(client: any, projectId?: string | null): Promise<Set<string>> {
  let query = client
    .from('page_layers')
    .select('layers')
    .eq('is_published', false)
    .is('deleted_at', null);
  query = (await applyProjectScopeToQuery(query, client, 'page_layers', projectId)).query;

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to fetch defined forms: ${error.message}`);
  }

  const formIds = new Set<string>();
  for (const row of data || []) {
    collectFormIdsFromLayers(row.layers, formIds);
  }
  return formIds;
}

/**
 * Get all forms with submission counts.
 *
 * Forms are defined by draft form layers. Submissions are merged onto those
 * definitions so newly migrated forms appear before the first visitor submits.
 */
export async function getFormSummaries(projectId?: string | null): Promise<FormSummary[]> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase client not configured');
  }

  const definedFormIds = await getDefinedFormIds(client, projectId);

  const submissionsQuery = client
    .from('form_submissions')
    .select('form_id, status, created_at')
    .order('created_at', { ascending: false });
  const { data, error } = await submissionsQuery;

  if (error) {
    throw new Error(`Failed to fetch form summaries: ${error.message}`);
  }

  // Group by form_id and calculate counts
  const formMap = new Map<string, FormSummary>();

  for (const formId of definedFormIds) {
    formMap.set(formId, {
      form_id: formId,
      submission_count: 0,
      new_count: 0,
      latest_submission: null,
    });
  }

  for (const submission of data || []) {
    const existing = formMap.get(submission.form_id);

    if (existing) {
      existing.submission_count++;
      if (submission.status === 'new') {
        existing.new_count++;
      }
    } else {
      formMap.set(submission.form_id, {
        form_id: submission.form_id,
        submission_count: 1,
        new_count: submission.status === 'new' ? 1 : 0,
        latest_submission: submission.created_at,
      });
    }
  }

  return Array.from(formMap.values()).sort((a, b) => {
    if (a.latest_submission && b.latest_submission) {
      return new Date(b.latest_submission).getTime() - new Date(a.latest_submission).getTime();
    }
    if (a.latest_submission) return -1;
    if (b.latest_submission) return 1;
    return a.form_id.localeCompare(b.form_id);
  });
}

/**
 * Create a new form submission
 */
export async function createFormSubmission(
  submissionData: CreateFormSubmissionData
): Promise<FormSubmission> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase client not configured');
  }

  const { data, error } = await client
    .from('form_submissions')
    .insert({
      form_id: submissionData.form_id,
      payload: submissionData.payload,
      metadata: submissionData.metadata || null,
      status: 'new',
      created_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create form submission: ${error.message}`);
  }

  return data;
}

/**
 * Update a form submission (e.g., change status)
 */
export async function updateFormSubmission(
  id: string,
  submissionData: UpdateFormSubmissionData
): Promise<FormSubmission> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase client not configured');
  }

  const { data, error } = await client
    .from('form_submissions')
    .update(submissionData)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update form submission: ${error.message}`);
  }

  return data;
}

/**
 * Delete a form submission
 */
export async function deleteFormSubmission(id: string): Promise<void> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase client not configured');
  }

  const { error } = await client
    .from('form_submissions')
    .delete()
    .eq('id', id);

  if (error) {
    throw new Error(`Failed to delete form submission: ${error.message}`);
  }
}

/**
 * Bulk delete form submissions by IDs
 */
export async function bulkDeleteFormSubmissions(ids: string[]): Promise<void> {
  if (ids.length === 0) return;

  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase client not configured');
  }

  const { error } = await client
    .from('form_submissions')
    .delete()
    .in('id', ids);

  if (error) {
    throw new Error(`Failed to bulk delete form submissions: ${error.message}`);
  }
}

/**
 * Delete all submissions for a form
 */
export async function deleteFormSubmissionsByFormId(formId: string): Promise<void> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase client not configured');
  }

  const { error } = await client
    .from('form_submissions')
    .delete()
    .eq('form_id', formId);

  if (error) {
    throw new Error(`Failed to delete form submissions: ${error.message}`);
  }
}

/**
 * Mark all submissions for a form as read
 */
export async function markAllAsRead(formId: string): Promise<void> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase client not configured');
  }

  const { error } = await client
    .from('form_submissions')
    .update({ status: 'read' })
    .eq('form_id', formId)
    .eq('status', 'new');

  if (error) {
    throw new Error(`Failed to mark submissions as read: ${error.message}`);
  }
}
