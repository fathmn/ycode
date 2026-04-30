import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Public API routes that skip authentication.
 */
const PUBLIC_API_PREFIXES = [
  '/ycode/api/supabase/', // Supabase config — needed for browser client init
  '/ycode/api/v1/',       // Public API — has own API key auth
];

/**
 * Patterns for collection item endpoints that must be accessible on published pages
 * (load-more pagination, filter). Matched via regex since the collection ID is dynamic.
 */
const PUBLIC_COLLECTION_ITEM_SUFFIXES = ['/items/filter', '/items/load-more'];

const PUBLIC_API_EXACT = [
  '/ycode/api/revalidate', // Cache revalidation — has own secret token auth
  '/ycode/api/setup/status', // Read-only setup status — required before login
  '/ycode/api/auth/callback', // Auth callback
  '/ycode/api/auth/session', // Session read for browser auth state
];

type ProjectIsolationCheck = {
  enabled: boolean;
  missingTables: string[];
};

const PROJECT_SCOPE_TABLES = [
  'pages',
  'page_layers',
  'assets',
  'asset_folders',
  'collections',
  'collection_items',
  'collection_fields',
  'collection_item_values',
  'components',
  'layer_styles',
  'settings',
  'locales',
  'translations',
  'page_folders',
];

let projectIsolationCache: Promise<ProjectIsolationCheck> | null = null;

function isSharedDbProjectScopeRequired(): boolean {
  return process.env.STUDIO_REQUIRE_SHARED_DB_PROJECT_SCOPE === '1';
}

function isMissingColumnError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as { message?: string; code?: string };
  if (typeof err.code === 'string' && err.code === 'PGRST106') return true;
  const message = (err.message || '').toLowerCase();
  return message.includes('could not find') && message.includes('column');
}

async function tableHasColumn(
  client: any,
  table: string,
  column: string
): Promise<boolean> {
  const { error } = await client.from(table).select(column).limit(0);
  return !isMissingColumnError(error);
}

async function tableSupportsProjectIsolation(client: any, table: string): Promise<boolean> {
  const [hasProjectId, hasTenantId] = await Promise.all([
    tableHasColumn(client, table, 'project_id'),
    tableHasColumn(client, table, 'tenant_id'),
  ]);
  return hasProjectId || hasTenantId;
}

async function checkProjectIsolation(client: any): Promise<ProjectIsolationCheck> {
  if (projectIsolationCache) return projectIsolationCache;

  projectIsolationCache = (async () => {
    const missingTables: string[] = [];
    for (const table of PROJECT_SCOPE_TABLES) {
      if (!(await tableSupportsProjectIsolation(client, table))) {
        missingTables.push(table);
      }
    }
    return {
      enabled: missingTables.length === 0,
      missingTables,
    };
  })();

  return projectIsolationCache;
}

const AUTH_ONLY_API_EXACT = [
  '/ycode/api/novum/projects', // Project picker must work before a project is selected
];

const MUTATING_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];
const READ_ROLES = ['novum_admin', 'novum_developer', 'customer_owner', 'customer_editor', 'customer_viewer'];
const WRITE_ROLES = ['novum_admin', 'novum_developer', 'customer_owner', 'customer_editor'];
const ADMIN_DEVELOPER_ROLES = ['novum_admin', 'novum_developer'];

const ADMIN_DEVELOPER_API_PREFIXES = [
  '/ycode/api/api-keys',
  '/ycode/api/apps',
  '/ycode/api/auth/invite',
  '/ycode/api/auth/users',
  '/ycode/api/cache/',
  '/ycode/api/devtools/',
  '/ycode/api/mcp-tokens',
  '/ycode/api/project/export',
  '/ycode/api/project/import',
  '/ycode/api/setup/connect',
  '/ycode/api/setup/migrate',
  '/ycode/api/updates',
  '/ycode/api/webhooks',
];

/**
 * Derive the Supabase project URL and anon key from environment variables.
 * Returns null if env vars are not set (pre-setup or local dev without .env.local).
 */
function getSupabaseEnvConfig(): { url: string; anonKey: string; secretKey?: string } | null {
  const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY
    || process.env.SUPABASE_ANON_KEY;
  const secretKey = process.env.SUPABASE_SECRET_KEY
    || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const connectionUrl = process.env.SUPABASE_CONNECTION_URL;

  if (!anonKey || !connectionUrl) return null;

  // Extract project ID from connection URL
  // e.g. "postgresql://postgres.abc123:..." → "abc123"
  const match = connectionUrl.match(/\/\/postgres\.([a-z0-9]+):/);
  if (!match) return null;

  return {
    url: `https://${match[1]}.supabase.co`,
    anonKey,
    secretKey,
  };
}

function isMutatingRequest(method: string): boolean {
  return MUTATING_METHODS.includes(method.toUpperCase());
}

function getRequiredRoles(pathname: string, method: string): string[] | null {
  if (ADMIN_DEVELOPER_API_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return ADMIN_DEVELOPER_ROLES;
  }

  if (isMutatingRequest(method)) {
    return WRITE_ROLES;
  }

  if (pathname.startsWith('/ycode/api') || pathname.startsWith('/ycode/preview')) {
    return READ_ROLES;
  }

  return null;
}

function isDevtoolsRoute(pathname: string): boolean {
  return pathname.startsWith('/ycode/api/devtools/');
}

function areDevtoolsEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' || process.env.NOVUM_ENABLE_DEVTOOLS === '1';
}

function isSafeProjectLookupValue(value: string): boolean {
  return /^[a-z0-9][a-z0-9.-]{0,252}[a-z0-9]$/i.test(value);
}

function getCurrentSiteKey(): string {
  return process.env.STUDIO_YCODE_SITE_KEY || 'default';
}

async function findProjectBySlugOrDomain(client: any, value: string): Promise<{ id: string } | null> {
  if (!isSafeProjectLookupValue(value)) return null;

  const bySlug = await client
    .from('novum_projects')
    .select('id')
    .eq('slug', value)
    .eq('status', 'active')
    .eq('ycode_site_key', getCurrentSiteKey())
    .maybeSingle();

  if (bySlug.error) return null;
  if (bySlug.data) return bySlug.data;

  const byDomain = await client
    .from('novum_projects')
    .select('id')
    .eq('primary_domain', value)
    .eq('status', 'active')
    .eq('ycode_site_key', getCurrentSiteKey())
    .maybeSingle();

  if (byDomain.error || !byDomain.data) return null;
  return byDomain.data;
}

function getAuditDescriptor(pathname: string, method: string): { action: string; entityType: string } | null {
  if (!isMutatingRequest(method)) return null;

  if (pathname.startsWith('/ycode/api/publish')) {
    return { action: 'site.publish.mutate', entityType: 'site' };
  }
  if (pathname.startsWith('/ycode/api/revert') || pathname.startsWith('/ycode/api/versions')) {
    return { action: 'site.version.mutate', entityType: 'version' };
  }
  if (pathname.startsWith('/ycode/api/novum/preview-approval')) {
    return { action: 'site.preview.approval.mutate', entityType: 'preview' };
  }
  if (pathname.startsWith('/ycode/api/pages') || pathname.startsWith('/ycode/api/folders')) {
    return { action: 'content.pages.mutate', entityType: 'page' };
  }
  if (pathname.startsWith('/ycode/api/layers')) {
    return { action: 'content.layers.mutate', entityType: 'layer' };
  }
  if (pathname.startsWith('/ycode/api/components')) {
    return { action: 'content.components.mutate', entityType: 'component' };
  }
  if (pathname.startsWith('/ycode/api/settings')) {
    return { action: 'settings.mutate', entityType: 'setting' };
  }
  if (
    pathname.startsWith('/ycode/api/color-variables') ||
    pathname.startsWith('/ycode/api/fonts') ||
    pathname.startsWith('/ycode/api/layer-styles')
  ) {
    return { action: 'design.mutate', entityType: 'design' };
  }
  if (pathname.startsWith('/ycode/api/locales') || pathname.startsWith('/ycode/api/translations')) {
    return { action: 'localization.mutate', entityType: 'localization' };
  }
  if (
    pathname.startsWith('/ycode/api/assets') ||
    pathname.startsWith('/ycode/api/asset-folders') ||
    pathname.startsWith('/ycode/api/files')
  ) {
    return { action: 'assets.mutate', entityType: 'asset' };
  }
  if (pathname.startsWith('/ycode/api/collections')) {
    return { action: 'cms.mutate', entityType: 'collection' };
  }
  if (pathname.startsWith('/ycode/api/form-submissions')) {
    return { action: 'forms.mutate', entityType: 'form' };
  }
  if (
    pathname.startsWith('/ycode/api/api-keys') ||
    pathname.startsWith('/ycode/api/apps') ||
    pathname.startsWith('/ycode/api/mcp-tokens') ||
    pathname.startsWith('/ycode/api/webhooks')
  ) {
    return { action: 'integrations.mutate', entityType: 'integration' };
  }
  if (pathname.startsWith('/ycode/api/auth/invite') || pathname.startsWith('/ycode/api/auth/users')) {
    return { action: 'users.mutate', entityType: 'user' };
  }
  if (pathname.startsWith('/ycode/api/project/export') || pathname.startsWith('/ycode/api/project/import')) {
    return { action: 'project.transfer.mutate', entityType: 'project' };
  }
  if (pathname.startsWith('/ycode/api/setup')) {
    return { action: 'setup.mutate', entityType: 'setup' };
  }
  if (pathname.startsWith('/ycode/api/devtools') || pathname.startsWith('/ycode/api/cache')) {
    return { action: 'developer_tools.mutate', entityType: 'developer_tool' };
  }

  return null;
}

async function writeProxyAuditLog(input: {
  config: { url: string; secretKey?: string };
  projectId: string | null;
  actorUserId: string;
  role: string;
  request: NextRequest;
}): Promise<void> {
  const descriptor = getAuditDescriptor(input.request.nextUrl.pathname, input.request.method);
  if (!descriptor || !input.config.secretKey || !input.projectId) return;

  try {
    const adminClient = createClient(input.config.url, input.config.secretKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    await adminClient.from('novum_audit_logs').insert({
      project_id: input.projectId,
      actor_user_id: input.actorUserId,
      action: descriptor.action,
      entity_type: descriptor.entityType,
      entity_id: input.request.nextUrl.pathname,
      metadata: {
        method: input.request.method,
        pathname: input.request.nextUrl.pathname,
        role: input.role,
        source: 'proxy_route_gate',
      },
    });
  } catch (error) {
    console.error('[novum] proxy audit log failed:', error);
  }
}

function resolveRequestedProjectSlug(request: NextRequest): string | null {
  const explicit = request.headers.get('x-novum-project-slug')
    || request.nextUrl.searchParams.get('project');
  if (explicit) return explicit;

  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || '';
  const hostname = host.split(':')[0];
  if (hostname && hostname !== 'localhost' && hostname !== '127.0.0.1') {
    return hostname;
  }

  return null;
}

function isPublicApiRoute(pathname: string, method: string): boolean {
  // POST to form-submissions is public (website visitors submitting forms)
  if (pathname === '/ycode/api/form-submissions' && method === 'POST') {
    return true;
  }

  if (PUBLIC_API_EXACT.includes(pathname)) return true;
  if (PUBLIC_API_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return true;

  // Collection item endpoints for published pages (POST only — filter, load-more)
  if (method === 'POST' && pathname.startsWith('/ycode/api/collections/') &&
      PUBLIC_COLLECTION_ITEM_SUFFIXES.some(suffix => pathname.endsWith(suffix))) {
    return true;
  }

  return false;
}

/**
 * Verify Supabase session for protected API routes.
 * Returns a 401 response if not authenticated, or null to continue.
 */
async function verifyApiAuth(request: NextRequest): Promise<NextResponse | null> {
  const config = getSupabaseEnvConfig();

  // If env vars aren't set (pre-setup or local dev without .env.local), allow only in non-production.
  // In production this must fail closed to avoid unprotected API access.
  if (!config) {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json(
        { error: 'Supabase is not configured' },
        { status: 500 },
      );
    }
    return null;
  }

  if (isPublicApiRoute(request.nextUrl.pathname, request.method)) {
    return null;
  }

  const bearer = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  let response = NextResponse.next({ request });

  const supabase = createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const authClient = bearer
    ? createClient(config.url, config.anonKey, {
      global: { headers: { Authorization: `Bearer ${bearer}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    })
    : supabase;

  const { data: { user } } = await authClient.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: 'Not authenticated' },
      { status: 401 }
    );
  }

  if (isDevtoolsRoute(request.nextUrl.pathname) && !areDevtoolsEnabled()) {
    return NextResponse.json(
      { error: 'Not found' },
      { status: 404 }
    );
  }

  if (AUTH_ONLY_API_EXACT.includes(request.nextUrl.pathname)) {
    return null;
  }

  const requiredRoles = getRequiredRoles(request.nextUrl.pathname, request.method);

  if (requiredRoles) {
    if (isSharedDbProjectScopeRequired()) {
      const isolation = await checkProjectIsolation(authClient);
      if (!isolation.enabled) {
        return NextResponse.json(
          {
            error: 'Project isolation schema is not enabled',
            code: 'STUDIO_PROJECT_SCOPE_REQUIRED',
            missingTables: isolation.missingTables,
          },
          { status: 409 }
        );
      }
    }

    const projectSlug = resolveRequestedProjectSlug(request);
    let membership: { role: string; project_id?: string } | null = null;
    let resolvedProjectId: string | null = null;
    let membershipError: { message?: string } | null = null;

    if (projectSlug) {
      const project = await findProjectBySlugOrDomain(authClient, projectSlug);

      if (!project) {
        return NextResponse.json(
          { error: 'No assigned Novum project resolved' },
          { status: 403 }
        );
      }

      const membershipResult = await authClient
        .from('novum_project_memberships')
        .select('role, project_id')
        .eq('project_id', project.id)
        .eq('user_id', user.id)
        .maybeSingle();
      membership = membershipResult.data;
      membershipError = membershipResult.error;
      resolvedProjectId = project.id;
    } else {
      const membershipResult = await authClient
        .from('novum_project_memberships')
        .select('role, project_id, project:novum_projects(status, ycode_site_key)')
        .eq('user_id', user.id);

      const activeSiteMemberships = (membershipResult.data || []).filter((item: any) => {
        const project = Array.isArray(item.project) ? item.project[0] : item.project;
        return project?.status === 'active' && project?.ycode_site_key === getCurrentSiteKey();
      });

      if (membershipResult.error || activeSiteMemberships.length !== 1) {
        return NextResponse.json(
          { error: 'Project selection required' },
          { status: 403 }
        );
      }

      membership = activeSiteMemberships[0];
      membershipError = null;
      resolvedProjectId = membership.project_id || null;
    }

    if (membershipError || !membership || !requiredRoles.includes(membership.role)) {
      return NextResponse.json(
        { error: 'Insufficient project role' },
        { status: 403 }
      );
    }

    await writeProxyAuditLog({
      config,
      projectId: resolvedProjectId,
      actorUserId: user.id,
      role: membership.role,
      request,
    });
  }

  return null;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // MCP endpoint uses its own token-based authentication — skip session auth.
  // Cloud overlay proxies MUST also exempt this path to avoid login redirects.
  if (pathname.startsWith('/ycode/mcp/')) {
    const response = NextResponse.next();
    response.headers.set('x-pathname', pathname);
    return response;
  }

  // Protect API and preview routes with auth
  if (pathname.startsWith('/ycode/api') || pathname.startsWith('/ycode/preview')) {
    const authResponse = await verifyApiAuth(request);
    if (authResponse) {
      if (pathname.startsWith('/ycode/preview')) {
        return NextResponse.redirect(new URL('/ycode', request.url));
      }
      return authResponse;
    }
  }

  const isPublicPage = !pathname.startsWith('/ycode')
    && !pathname.startsWith('/_next')
    && !pathname.startsWith('/api')
    && !pathname.startsWith('/dynamic');
  const hasPaginationParams = Array.from(request.nextUrl.searchParams.keys())
    .some((key) => key.startsWith('p_'));

  if (isPublicPage && hasPaginationParams) {
    const rewriteUrl = request.nextUrl.clone();
    rewriteUrl.pathname = pathname === '/' ? '/dynamic' : `/dynamic${pathname}`;

    const rewriteResponse = NextResponse.rewrite(rewriteUrl);
    rewriteResponse.headers.set('x-pathname', pathname);
    return rewriteResponse;
  }

  // Create response
  const response = NextResponse.next();

  // Add pathname header for layout to determine dark mode
  response.headers.set('x-pathname', pathname);

  // Cache-Control for public pages is configured centrally via next.config.ts headers().

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
