import { NextRequest } from 'next/server';
import { noCache } from '@/lib/api-response';
import { getSupabaseAdmin } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function extractSupabaseAccessToken(request: NextRequest): string | null {
  const bearer = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (bearer) return bearer;

  for (const cookie of request.cookies.getAll()) {
    if (!cookie.name.includes('auth-token')) continue;

    try {
      const parsed = JSON.parse(decodeURIComponent(cookie.value));
      if (Array.isArray(parsed) && typeof parsed[0] === 'string') return parsed[0];
      if (typeof parsed?.access_token === 'string') return parsed.access_token;
      if (typeof parsed?.currentSession?.access_token === 'string') {
        return parsed.currentSession.access_token;
      }
    } catch {
      // Supabase cookie formats can differ between helpers.
    }
  }

  return null;
}

function getCurrentSiteKey(): string {
  return process.env.STUDIO_YCODE_SITE_KEY || 'default';
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
    .from('novum_project_memberships')
    .select(`
      role,
      project:novum_projects (
        id,
        slug,
        name,
        primary_domain,
        status,
        ycode_site_key
      )
    `)
    .eq('user_id', user.id);

  if (error) {
    return noCache({ error: error.message }, 500);
  }

  const projects = (data || [])
    .map((membership: any) => {
      const project = Array.isArray(membership.project)
        ? membership.project[0]
        : membership.project;

      if (
        !project?.id ||
        !project?.slug ||
        project.status !== 'active' ||
        project.ycode_site_key !== getCurrentSiteKey()
      ) return null;

      return {
        id: project.id,
        slug: project.slug,
        name: project.name,
        primary_domain: project.primary_domain,
        status: project.status,
        role: membership.role,
      };
    })
    .filter(Boolean)
    .sort((a: any, b: any) => a.name.localeCompare(b.name));

  return noCache({ data: projects });
}
