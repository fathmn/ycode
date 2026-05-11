import { getSupabaseAdmin } from '@/lib/supabase-server';
import { getAuthUser } from '@/lib/supabase-auth';
export { projectLookupFromHost } from '@/lib/project-host';

const projectScopeColumnCache = new Set<string>();

function isMissingColumnError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as { message?: string; code?: string; details?: string; hint?: string };
  if (err.code === '42703') return true;
  const message = [err.message, err.details, err.hint].filter(Boolean).join(' ').toLowerCase();
  return (
    message.includes('column')
    && (
      message.includes('could not find')
      || message.includes('does not exist')
      || message.includes('schema cache')
    )
  );
}

export function isSharedDbProjectScopeRequired(): boolean {
  return process.env.STUDIO_REQUIRE_SHARED_DB_PROJECT_SCOPE === '1';
}

export async function tableHasProjectScopeColumn(client: any, tableName: string): Promise<boolean> {
  if (projectScopeColumnCache.has(tableName)) {
    return true;
  }
  const { error } = await client.from(tableName).select('project_id').limit(0);
  if (!error) {
    projectScopeColumnCache.add(tableName);
    return true;
  }
  if (!isMissingColumnError(error)) {
    throw new Error(`Failed to inspect project scope for ${tableName}: ${error.message}`);
  }
  return false;
}

export async function applyProjectScopeToQuery(query: any, client: any, tableName: string, projectId?: string | null): Promise<{ query: any }> {
  const hasProjectScope = await tableHasProjectScopeColumn(client, tableName);
  if (!hasProjectScope) {
    if (isSharedDbProjectScopeRequired()) {
      throw new Error(`Project scope column is required for ${tableName}`);
    }
    return { query };
  }
  if (!projectId) {
    if (isSharedDbProjectScopeRequired()) {
      throw new Error(`Project scope is required for ${tableName}`);
    }
    return { query };
  }
  return { query: query.eq('project_id', projectId) };
}

export function isSafeProjectLookupValue(value: string): boolean {
  return /^[a-z0-9][a-z0-9.-]{0,252}[a-z0-9]$/i.test(value);
}

export function getCurrentYcodeSiteKey(): string {
  return process.env.STUDIO_YCODE_SITE_KEY || 'default';
}

export async function resolveNovumProjectId(value: string | null | undefined): Promise<string | null> {
  if (!value || !isSafeProjectLookupValue(value)) return null;
  const client = await getSupabaseAdmin();
  if (!client) return null;

  const baseSelect = 'id';
  const bySlug = await client
    .from('novum_projects')
    .select(baseSelect)
    .eq('slug', value)
    .eq('status', 'active')
    .eq('ycode_site_key', getCurrentYcodeSiteKey())
    .maybeSingle();
  if (!bySlug.error && bySlug.data?.id) return bySlug.data.id;

  const byDomain = await client
    .from('novum_projects')
    .select(baseSelect)
    .eq('primary_domain', value)
    .eq('status', 'active')
    .eq('ycode_site_key', getCurrentYcodeSiteKey())
    .maybeSingle();
  if (!byDomain.error && byDomain.data?.id) return byDomain.data.id;

  return null;
}

export async function resolveSingleNovumProjectIdForCurrentUser(): Promise<string | null> {
  const auth = await getAuthUser();
  if (!auth?.user?.id) return null;
  return resolveSingleNovumProjectIdForUser(auth.user.id);
}

export async function resolveSingleNovumProjectIdForUser(userId: string): Promise<string | null> {
  if (!userId) return null;
  const client = await getSupabaseAdmin();
  if (!client) return null;

  const { data, error } = await client
    .from('novum_project_memberships')
    .select('project_id, project:novum_projects(id, status, ycode_site_key)')
    .eq('user_id', userId);
  if (error || !Array.isArray(data)) return null;

  const matchingMemberships = data.filter((membership: any) => {
    const project = Array.isArray(membership.project) ? membership.project[0] : membership.project;
    return project?.status === 'active' && project?.ycode_site_key === getCurrentYcodeSiteKey();
  });
  if (matchingMemberships.length !== 1) return null;
  return matchingMemberships[0].project_id || null;
}
