import { NextRequest } from 'next/server';
import { noCache } from '@/lib/api-response';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { extractSupabaseAccessToken } from '@/lib/supabase-cookie-token';
import { findDuplicateStudioProjectPathSlugs, studioProjectPathSlug } from '@/lib/studio-project-path';
import { getConfiguredSiteAdminRoleForUser } from '@/lib/studio-site-admin';
import { type StudioRole, normalizeStudioRole } from '@/lib/studio-roles';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function getCurrentSiteKey(): string {
  return process.env.STUDIO_YCODE_SITE_KEY || 'default';
}

function shouldScopeStudioProjectListToCurrentSiteKey(): boolean {
  return process.env.STUDIO_SCOPE_PROJECT_LIST_TO_CURRENT_SITE_KEY === '1';
}

function normalizePublicUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withProtocol);
    return `${url.protocol}//${url.host}`.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

function getProjectProductionUrl(project: {
  primary_domain?: string | null;
  metadata?: Record<string, unknown> | null;
}): string | null {
  const metadata = project.metadata && typeof project.metadata === 'object' ? project.metadata : {};
  const primaryDomainVerified = metadata.primaryDomainVerified === true
    || metadata.primary_domain_verified === true
    || metadata.primaryDomainStatus === 'active'
    || metadata.primary_domain_status === 'active';

  if (primaryDomainVerified) {
    return normalizePublicUrl(project.primary_domain);
  }

  return normalizePublicUrl(metadata.productionUrl)
    || normalizePublicUrl(metadata.production_url)
    || normalizePublicUrl(metadata.vercelProductionUrl)
    || normalizePublicUrl(metadata.vercel_production_url);
}

export async function GET(request: NextRequest) {
  const client = await getSupabaseAdmin();
  if (!client) {
    return noCache({ error: 'Supabase is not configured' }, 500);
  }

  const token = extractSupabaseAccessToken(request);
  if (!token) {
    return noCache({ error: 'Not authenticated' }, 401);
  }

  const { data: userData, error: userError } = await client.auth.getUser(token);
  const user = userData.user;
  if (userError || !user) {
    return noCache({ error: 'Not authenticated' }, 401);
  }

  const { data, error } = await client
    .from('studio_project_memberships')
    .select(`
      role,
      project:studio_projects (
        id,
        slug,
        name,
        primary_domain,
        metadata,
        status,
        ycode_site_key
      )
    `)
    .eq('user_id', user.id);

  if (error) {
    return noCache({ error: error.message }, 500);
  }

  const activeMemberships = (data || [])
    .map((membership: any) => {
      const project = Array.isArray(membership.project)
        ? membership.project[0]
        : membership.project;
      if (
        !project?.id ||
        !project?.slug ||
        project.status !== 'active' ||
        (
          shouldScopeStudioProjectListToCurrentSiteKey() &&
          project.ycode_site_key !== getCurrentSiteKey()
        )
      ) return null;
      const role = normalizeStudioRole(membership.role);
      if (!role) return null;
      return { role, project };
    })
    .filter((membership): membership is { role: StudioRole; project: any } => Boolean(membership));

  const siteAdminRole = getConfiguredSiteAdminRoleForUser(user);

  let projectRows: Array<{ role: StudioRole; project: any }> = activeMemberships;
  let activeSiteProjectsForPathCheck = activeMemberships.map((membership: any) => membership.project);

  if (siteAdminRole) {
    let allProjectsQuery = client
      .from('studio_projects')
      .select('id, slug, name, primary_domain, metadata, status, ycode_site_key')
      .eq('status', 'active');
    if (shouldScopeStudioProjectListToCurrentSiteKey()) {
      allProjectsQuery = allProjectsQuery.eq('ycode_site_key', getCurrentSiteKey());
    }
    const { data: allProjects, error: allProjectsError } = await allProjectsQuery;

    if (allProjectsError) {
      return noCache({ error: allProjectsError.message }, 500);
    }

    activeSiteProjectsForPathCheck = allProjects || [];
    projectRows = (allProjects || []).map((project: any) => ({
      role: siteAdminRole,
      project,
    }));
  } else {
    let allActiveProjectsQuery = client
      .from('studio_projects')
      .select('id, slug, metadata')
      .eq('status', 'active');
    if (shouldScopeStudioProjectListToCurrentSiteKey()) {
      allActiveProjectsQuery = allActiveProjectsQuery.eq('ycode_site_key', getCurrentSiteKey());
    }
    const { data: allActiveProjects, error: allActiveProjectsError } = await allActiveProjectsQuery;

    if (allActiveProjectsError) {
      return noCache({ error: allActiveProjectsError.message }, 500);
    }

    activeSiteProjectsForPathCheck = allActiveProjects || [];
  }

  const duplicatePathSlugs = findDuplicateStudioProjectPathSlugs(
    activeSiteProjectsForPathCheck
  );
  if (duplicatePathSlugs.length > 0) {
    return noCache(
      {
        error: 'Duplicate Studio project path aliases detected',
        code: 'STUDIO_DUPLICATE_STUDIO_PROJECT_PATH',
        ...(siteAdminRole ? { pathSlugs: duplicatePathSlugs } : {}),
      },
      409
    );
  }

  const projects = projectRows
    .map((membership: any) => {
      const project = membership.project;

      if (
        !project?.id ||
        !project?.slug ||
        project.status !== 'active' ||
        (
          shouldScopeStudioProjectListToCurrentSiteKey() &&
          project.ycode_site_key !== getCurrentSiteKey()
        )
      ) return null;

      return {
        id: project.id,
        slug: project.slug,
        studio_path_slug: studioProjectPathSlug(project),
        studio_path: studioProjectPathSlug(project) ? `/${studioProjectPathSlug(project)}` : null,
        name: project.name,
        primary_domain: project.primary_domain,
        production_url: getProjectProductionUrl(project),
        status: project.status,
        role: membership.role,
      };
    })
    .filter(Boolean)
    .sort((a: any, b: any) => a.name.localeCompare(b.name));

  return noCache({ data: projects });
}
