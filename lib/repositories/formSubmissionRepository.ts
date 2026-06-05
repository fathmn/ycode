import { getSupabaseAdmin } from '@/lib/supabase-server';
import { applyProjectScopeToQuery, isSharedDbProjectScopeRequired, tableHasProjectScopeColumn } from '@/lib/project-scope';
import { resolveFormLayerId } from '@/lib/form-layer';
import type {
  Layer,
  FormSubmission,
  FormSummary,
  CreateFormSubmissionData,
  UpdateFormSubmissionData,
  FormSubmissionStatus,
  FormSettings,
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
  projectId?: string | null
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

  query = (await applyProjectScopeToQuery(query, client, 'form_submissions', projectId)).query;

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to fetch form submissions: ${error.message}`);
  }

  return data || [];
}

/**
 * Get form submission by ID
 */
export async function getFormSubmissionById(
  id: string,
  projectId?: string | null
): Promise<FormSubmission | null> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase client not configured');
  }

  let query = client
    .from('form_submissions')
    .select('*')
    .eq('id', id);
  query = (await applyProjectScopeToQuery(query, client, 'form_submissions', projectId)).query;

  const { data, error } = await query
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
  const layerList = Array.isArray(layers)
    ? layers
    : (layers && typeof layers === 'object' ? [layers] : []);

  for (const layer of layerList as Layer[]) {
    if (!layer || typeof layer !== 'object') continue;
    const formId = resolveFormLayerId(layer);
    if (formId) formIds.add(formId);
    collectFormIdsFromLayers(layer.children, formIds);
  }
}

function findFormEmailNotification(
  layers: Layer[] | unknown,
  formId: string
): FormSettings['email_notification'] | null {
  const layerList = Array.isArray(layers)
    ? layers
    : (layers && typeof layers === 'object' ? [layers] : []);

  for (const layer of layerList as Layer[]) {
    if (!layer || typeof layer !== 'object') continue;
    if (resolveFormLayerId(layer) === formId) {
      return layer.settings?.form?.email_notification || null;
    }

    const childMatch = findFormEmailNotification(layer.children, formId);
    if (childMatch) return childMatch;
  }

  return null;
}

function applyPublishedState(query: any, isPublished?: boolean): any {
  return typeof isPublished === 'boolean'
    ? query.eq('is_published', isPublished)
    : query;
}

async function getDefinedFormIds(
  client: any,
  projectId?: string | null,
  isPublished?: boolean
): Promise<Set<string>> {
  let query = client
    .from('page_layers')
    .select('layers')
    .is('deleted_at', null);
  query = applyPublishedState(query, isPublished);
  query = (await applyProjectScopeToQuery(query, client, 'page_layers', projectId)).query;

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to fetch defined forms: ${error.message}`);
  }

  const formIds = new Set<string>();
  for (const row of data || []) {
    collectFormIdsFromLayers(row.layers, formIds);
  }

  let componentsQuery = client
    .from('components')
    .select('layers')
    .is('deleted_at', null);
  componentsQuery = applyPublishedState(componentsQuery, isPublished);
  componentsQuery = (await applyProjectScopeToQuery(componentsQuery, client, 'components', projectId)).query;

  const { data: components, error: componentsError } = await componentsQuery;
  if (componentsError) {
    throw new Error(`Failed to fetch component forms: ${componentsError.message}`);
  }

  for (const component of components || []) {
    collectFormIdsFromLayers(component.layers, formIds);
  }

  return formIds;
}

async function getDefinedFormIdsAcrossStates(
  client: any,
  projectId?: string | null
): Promise<Set<string>> {
  const [draftFormIds, publishedFormIds] = await Promise.all([
    getDefinedFormIds(client, projectId, false),
    getDefinedFormIds(client, projectId, true),
  ]);

  return new Set([...draftFormIds, ...publishedFormIds]);
}

export async function hasDefinedFormId(
  formId: string,
  projectId?: string | null,
  isPublished?: boolean
): Promise<boolean> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase client not configured');
  }

  const formIds = await getDefinedFormIds(client, projectId, isPublished);
  return formIds.has(formId);
}

export async function getDefinedFormEmailNotification(
  formId: string,
  projectId?: string | null,
  isPublished?: boolean
): Promise<FormSettings['email_notification'] | null> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase client not configured');
  }

  let query = client
    .from('page_layers')
    .select('layers')
    .is('deleted_at', null);
  query = applyPublishedState(query, isPublished);
  query = (await applyProjectScopeToQuery(query, client, 'page_layers', projectId)).query;

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to fetch form notification settings: ${error.message}`);
  }

  for (const row of data || []) {
    const notification = findFormEmailNotification(row.layers, formId);
    if (notification) return notification;
  }

  let componentsQuery = client
    .from('components')
    .select('layers')
    .is('deleted_at', null);
  componentsQuery = applyPublishedState(componentsQuery, isPublished);
  componentsQuery = (await applyProjectScopeToQuery(componentsQuery, client, 'components', projectId)).query;

  const { data: components, error: componentsError } = await componentsQuery;
  if (componentsError) {
    throw new Error(`Failed to fetch component form notification settings: ${componentsError.message}`);
  }

  for (const component of components || []) {
    const notification = findFormEmailNotification(component.layers, formId);
    if (notification) return notification;
  }

  return null;
}

/**
 * Get all forms with submission counts.
 *
 * Forms are defined by draft and published form layers. Submissions are merged
 * onto those definitions so newly migrated or already-live forms appear before
 * the first visitor submits.
 */
export async function getFormSummaries(projectId?: string | null): Promise<FormSummary[]> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase client not configured');
  }

  const definedFormIds = await getDefinedFormIdsAcrossStates(client, projectId);

  const submissionsQuery = client
    .from('form_submissions')
    .select('form_id, status, created_at')
    .order('created_at', { ascending: false });
  const scopedSubmissionsQuery = (await applyProjectScopeToQuery(
    submissionsQuery,
    client,
    'form_submissions',
    projectId
  )).query;
  const { data, error } = await scopedSubmissionsQuery;

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
      if (
        !existing.latest_submission
        || new Date(submission.created_at).getTime() > new Date(existing.latest_submission).getTime()
      ) {
        existing.latest_submission = submission.created_at;
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
  submissionData: CreateFormSubmissionData,
  projectId?: string | null
): Promise<FormSubmission> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase client not configured');
  }

  const row: Record<string, any> = {
    form_id: submissionData.form_id,
    payload: submissionData.payload,
    metadata: submissionData.metadata || null,
    status: 'new',
    created_at: new Date().toISOString(),
  };
  const hasProjectScope = await tableHasProjectScopeColumn(client, 'form_submissions');
  if (hasProjectScope && projectId) {
    row.project_id = projectId;
  } else if (hasProjectScope && isSharedDbProjectScopeRequired()) {
    throw new Error('Project scope is required for form_submissions');
  }

  const { data, error } = await client
    .from('form_submissions')
    .insert(row)
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
  submissionData: UpdateFormSubmissionData,
  projectId?: string | null
): Promise<FormSubmission> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase client not configured');
  }

  let query = client
    .from('form_submissions')
    .update(submissionData)
    .eq('id', id);
  query = (await applyProjectScopeToQuery(query, client, 'form_submissions', projectId)).query;

  const { data, error } = await query
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
export async function deleteFormSubmission(
  id: string,
  projectId?: string | null
): Promise<void> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase client not configured');
  }

  let query = client
    .from('form_submissions')
    .delete()
    .eq('id', id);
  query = (await applyProjectScopeToQuery(query, client, 'form_submissions', projectId)).query;

  const { error } = await query;

  if (error) {
    throw new Error(`Failed to delete form submission: ${error.message}`);
  }
}

/**
 * Bulk delete form submissions by IDs
 */
export async function bulkDeleteFormSubmissions(
  ids: string[],
  projectId?: string | null
): Promise<void> {
  if (ids.length === 0) return;

  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase client not configured');
  }

  let query = client
    .from('form_submissions')
    .delete()
    .in('id', ids);
  query = (await applyProjectScopeToQuery(query, client, 'form_submissions', projectId)).query;

  const { error } = await query;

  if (error) {
    throw new Error(`Failed to bulk delete form submissions: ${error.message}`);
  }
}

/**
 * Delete all submissions for a form
 */
export async function deleteFormSubmissionsByFormId(
  formId: string,
  projectId?: string | null
): Promise<void> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase client not configured');
  }

  let query = client
    .from('form_submissions')
    .delete()
    .eq('form_id', formId);
  query = (await applyProjectScopeToQuery(query, client, 'form_submissions', projectId)).query;

  const { error } = await query;

  if (error) {
    throw new Error(`Failed to delete form submissions: ${error.message}`);
  }
}

/**
 * Mark all submissions for a form as read
 */
export async function markAllAsRead(
  formId: string,
  projectId?: string | null
): Promise<void> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase client not configured');
  }

  let query = client
    .from('form_submissions')
    .update({ status: 'read' })
    .eq('form_id', formId)
    .eq('status', 'new');
  query = (await applyProjectScopeToQuery(query, client, 'form_submissions', projectId)).query;

  const { error } = await query;

  if (error) {
    throw new Error(`Failed to mark submissions as read: ${error.message}`);
  }
}
