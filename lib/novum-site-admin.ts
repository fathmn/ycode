import {
  STUDIO_ADMIN_ROLE,
  STUDIO_DEVELOPER_ROLE,
  type StudioRole,
  normalizeStudioRole,
} from '@/lib/studio-roles';

type SupabaseUserLike = {
  email?: string | null;
  app_metadata?: Record<string, unknown> | null;
};

export type NovumSiteAdminRole = Extract<StudioRole, 'studio_admin' | 'studio_developer'>;

function splitList(value: string | undefined): string[] {
  return (value || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function roleFromAppMetadata(metadata: Record<string, unknown> | null | undefined): NovumSiteAdminRole | null {
  if (!metadata || typeof metadata !== 'object') return null;

  const role = metadata.novumSiteRole || metadata.novum_site_role || metadata.studioSiteRole || metadata.studio_site_role;
  const normalizedRole = typeof role === 'string' ? normalizeStudioRole(role) : null;
  if (normalizedRole === STUDIO_ADMIN_ROLE || normalizedRole === STUDIO_DEVELOPER_ROLE) return normalizedRole;

  if (
    metadata.novumSiteAdmin === true
    || metadata.novum_site_admin === true
    || metadata.studioSiteAdmin === true
    || metadata.studio_site_admin === true
  ) {
    return STUDIO_ADMIN_ROLE;
  }

  return null;
}

export function getConfiguredSiteAdminRoleForUser(user: SupabaseUserLike | null | undefined): NovumSiteAdminRole | null {
  if (!user) return null;

  const metadataRole = roleFromAppMetadata(user.app_metadata);
  if (metadataRole) return metadataRole;

  const email = user.email?.trim().toLowerCase();
  if (!email) return null;

  const adminEmails = splitList(process.env.STUDIO_SITE_ADMIN_EMAILS || process.env.NOVUM_SITE_ADMIN_EMAILS);
  if (adminEmails.includes(email)) return STUDIO_ADMIN_ROLE;

  const developerEmails = splitList(process.env.STUDIO_SITE_DEVELOPER_EMAILS || process.env.NOVUM_SITE_DEVELOPER_EMAILS);
  if (developerEmails.includes(email)) return STUDIO_DEVELOPER_ROLE;

  return null;
}
