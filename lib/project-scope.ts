import { getSupabaseAdmin } from '@/lib/supabase-server';
import { getAuthUser } from '@/lib/supabase-auth';
import { findStudioProjectPathMatches } from '@/lib/studio-project-path';
import { findStudioProjectHostMatches } from '@/lib/studio-project-hostnames';
import { getConfiguredSiteAdminRoleForUser } from '@/lib/studio-site-admin';
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

export async function resolveProjectScopeForWrite(client: any, tableName: string, projectId?: string | null): Promise<boolean> {
  const hasProjectScope = await tableHasProjectScopeColumn(client, tableName);
  if (isSharedDbProjectScopeRequired()) {
    if (!hasProjectScope) {
      throw new Error(`Project scope column is required for ${tableName}`);
    }
    if (!projectId) {
      throw new Error(`Project scope is required for ${tableName}`);
    }
  }
  return hasProjectScope;
}

export function isSafeProjectLookupValue(value: string): boolean {
  return /^[a-z0-9][a-z0-9.-]{0,252}[a-z0-9]$/i.test(value);
}

export function getCurrentYcodeSiteKey(): string {
  return process.env.STUDIO_YCODE_SITE_KEY || 'default';
}

async function hasSiteAdminRole(client: any, userId: string): Promise<boolean> {
  const { data, error } = await client.auth.admin.getUserById(userId);
  if (error) return false;
  return Boolean(getConfiguredSiteAdminRoleForUser(data?.user));
}

export async function resolveStudioProjectId(value: string | null | undefined): Promise<string | null> {
  if (!value || !isSafeProjectLookupValue(value)) return null;
  const client = await getSupabaseAdmin();
  if (!client) return null;

  const activeProjects = await client
    .from('studio_projects')
    .select('id, slug, primary_domain, metadata')
    .eq('status', 'active');
  if (activeProjects.error || !Array.isArray(activeProjects.data)) return null;
  const aliasMatches = findStudioProjectPathMatches(activeProjects.data, value);
  const hostMatches = findStudioProjectHostMatches(activeProjects.data, value);

  const baseSelect = 'id';
  const bySlug = await client
    .from('studio_projects')
    .select(baseSelect)
    .eq('slug', value)
    .eq('status', 'active')
    .maybeSingle();
  if (bySlug.error) return null;
  if (bySlug.data?.id) {
    return bySlug.data.id;
  }

  const byDomain = await client
    .from('studio_projects')
    .select(baseSelect)
    .eq('primary_domain', value)
    .eq('status', 'active')
    .maybeSingle();
  if (!byDomain.error && byDomain.data?.id) return byDomain.data.id;

  const hostMatch = hostMatches.length === 1 ? hostMatches[0] : null;
  if (hostMatch?.id) return hostMatch.id;

  const match = aliasMatches.length === 1 ? aliasMatches[0] : null;
  if (match?.id) return match.id;

  return null;
}

export async function resolveSingleStudioProjectIdForCurrentUser(): Promise<string | null> {
  const auth = await getAuthUser();
  if (!auth?.user?.id) return null;
  return resolveSingleStudioProjectIdForUser(auth.user.id);
}

export async function resolveSingleStudioProjectIdForUser(userId: string): Promise<string | null> {
  if (!userId) return null;
  const client = await getSupabaseAdmin();
  if (!client) return null;
  if (await hasSiteAdminRole(client, userId)) return null;

  const { data, error } = await client
    .from('studio_project_memberships')
    .select('project_id, project:studio_projects(id, status, ycode_site_key)')
    .eq('user_id', userId);
  if (error || !Array.isArray(data)) return null;

  const matchingMemberships = data.filter((membership: any) => {
    const project = Array.isArray(membership.project) ? membership.project[0] : membership.project;
    return project?.status === 'active';
  });
  if (matchingMemberships.length !== 1) return null;
  return matchingMemberships[0].project_id || null;
}
