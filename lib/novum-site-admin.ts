type SupabaseUserLike = {
  email?: string | null;
  app_metadata?: Record<string, unknown> | null;
};

export type NovumSiteAdminRole = 'novum_admin' | 'novum_developer';

function splitList(value: string | undefined): string[] {
  return (value || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function roleFromAppMetadata(metadata: Record<string, unknown> | null | undefined): NovumSiteAdminRole | null {
  if (!metadata || typeof metadata !== 'object') return null;

  const role = metadata.novumSiteRole || metadata.novum_site_role || metadata.studioSiteRole || metadata.studio_site_role;
  if (role === 'novum_admin' || role === 'site_admin') return 'novum_admin';
  if (role === 'novum_developer' || role === 'site_developer') return 'novum_developer';

  if (
    metadata.novumSiteAdmin === true
    || metadata.novum_site_admin === true
    || metadata.studioSiteAdmin === true
    || metadata.studio_site_admin === true
  ) {
    return 'novum_admin';
  }

  return null;
}

export function getConfiguredSiteAdminRoleForUser(user: SupabaseUserLike | null | undefined): NovumSiteAdminRole | null {
  if (!user) return null;

  const metadataRole = roleFromAppMetadata(user.app_metadata);
  if (metadataRole) return metadataRole;

  const email = user.email?.trim().toLowerCase();
  if (!email) return null;

  const adminEmails = splitList(process.env.NOVUM_SITE_ADMIN_EMAILS || process.env.STUDIO_SITE_ADMIN_EMAILS);
  if (adminEmails.includes(email)) return 'novum_admin';

  const developerEmails = splitList(process.env.NOVUM_SITE_DEVELOPER_EMAILS || process.env.STUDIO_SITE_DEVELOPER_EMAILS);
  if (developerEmails.includes(email)) return 'novum_developer';

  return null;
}
