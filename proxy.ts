import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { STUDIO_PREVIEW_NONCE_COOKIE } from '@/lib/studio-preview-nonce';
import { projectLookupFromHost } from '@/lib/project-host';
import { findStudioProjectPathMatches } from '@/lib/studio-project-path';
import { findStudioProjectHostMatches } from '@/lib/studio-project-hostnames';
import { getConfiguredSiteAdminRoleForUser } from '@/lib/studio-site-admin';
import {
  CUSTOMER_OWNER_ROLE,
  STUDIO_INTEGRATION_MANAGER_ROLES,
  STUDIO_OPERATOR_ROLES,
  STUDIO_READ_ROLES,
  STUDIO_WRITE_ROLES,
  type StudioRole,
  hasAllowedStudioRole,
  normalizeStudioRole,
} from '@/lib/studio-roles';

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
  '/ycode/api/setup/check-email-confirm', // Read-only setup check — required before first admin exists
  '/ycode/api/auth/callback', // Auth callback
  '/ycode/api/auth/confirm', // Auth email token confirmation
  '/ycode/api/auth/session', // Session read for browser auth state
];

type ProjectIsolationCheck = {
  enabled: boolean;
  missingTables: string[];
};

type ApiAuthResult =
  | { ok: true; requestHeaders?: Headers }
  | { ok: false; response: NextResponse };

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
  'app_settings',
  'webhooks',
  'webhook_deliveries',
  'api_keys',
];

const DRAFT_FINGERPRINT_TABLES = [
  'page_folders',
  'pages',
  'page_layers',
  'collections',
  'collection_fields',
  'collection_items',
  'collection_item_values',
  'components',
  'layer_styles',
  'asset_folders',
  'assets',
  'fonts',
  'locales',
  'translations',
];

let projectIsolationCache: Promise<ProjectIsolationCheck> | null = null;

function isSharedDbProjectScopeRequired(): boolean {
  return process.env.STUDIO_REQUIRE_SHARED_DB_PROJECT_SCOPE === '1';
}

function isProjectScopedApiVerified(): boolean {
  return process.env.STUDIO_PROJECT_SCOPED_API_VERIFIED === '1';
}

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

async function tableHasColumn(
  client: any,
  table: string,
  column: string
): Promise<boolean> {
  const { error } = await client.from(table).select(column).limit(0);
  if (!error) return true;
  if (isMissingColumnError(error)) return false;
  throw new Error(`Failed to inspect ${table}.${column}: ${error.message || 'unknown database error'}`);
}

async function tableSupportsProjectIsolation(client: any, table: string): Promise<boolean> {
  return tableHasColumn(client, table, 'project_id');
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
  '/ycode/api/studio/projects', // Project picker must work before a project is selected
  '/ycode/api/studio/preview-rendered', // The route binds project access to the signed preview nonce.
];

const BUILDER_ONLY_MUTATION_PREFIXES = [
  '/ycode/api/publish',
  '/ycode/api/studio/preview-approval',
];

const MUTATING_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];
const READ_ROLES = STUDIO_READ_ROLES;
const WRITE_ROLES = STUDIO_WRITE_ROLES;
const PUBLISH_ROLES: StudioRole[] = [...STUDIO_OPERATOR_ROLES, CUSTOMER_OWNER_ROLE];
const ADMIN_DEVELOPER_ROLES = STUDIO_OPERATOR_ROLES;
const INTEGRATION_MANAGER_ROLES = STUDIO_INTEGRATION_MANAGER_ROLES;

const ADMIN_DEVELOPER_API_PREFIXES = [
  '/ycode/api/auth/invite',
  '/ycode/api/auth/users',
  '/ycode/api/cache/',
  '/ycode/api/devtools/',
  '/ycode/api/project/export',
  '/ycode/api/project/import',
  '/ycode/api/setup/connect',
  '/ycode/api/setup/migrate',
  '/ycode/api/updates',
];

const PROJECT_INTEGRATION_API_PREFIXES = [
  '/ycode/api/api-keys',
  '/ycode/api/apps',
  '/ycode/api/mcp-tokens',
  '/ycode/api/webhooks',
];

const GLOBAL_SITE_ADMIN_API_PREFIXES = [
  '/ycode/api/setup/connect',
  '/ycode/api/setup/migrate',
  '/ycode/api/updates',
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

function getRequiredRoles(pathname: string, method: string): StudioRole[] | null {
  if (PROJECT_INTEGRATION_API_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return INTEGRATION_MANAGER_ROLES;
  }

  if (ADMIN_DEVELOPER_API_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return ADMIN_DEVELOPER_ROLES;
  }

  if (pathname.startsWith('/ycode/api/publish') && isMutatingRequest(method)) {
    return PUBLISH_ROLES;
  }

  if (isMutatingRequest(method)) {
    return WRITE_ROLES;
  }

  if (pathname.startsWith('/ycode/api') || pathname.startsWith('/ycode/preview')) {
    return READ_ROLES;
  }

  return null;
}

function isGlobalSiteAdminRoute(pathname: string): boolean {
  return GLOBAL_SITE_ADMIN_API_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function isDevtoolsRoute(pathname: string): boolean {
  return pathname.startsWith('/ycode/api/devtools/');
}

function areDevtoolsEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' || process.env.STUDIO_ENABLE_DEVTOOLS === '1';
}

function isSafeProjectLookupValue(value: string): boolean {
  return /^[a-z0-9][a-z0-9.-]{0,252}[a-z0-9]$/i.test(value);
}

function getCurrentSiteKey(): string {
  return process.env.STUDIO_YCODE_SITE_KEY || 'default';
}

function getStudioAppHost(): string {
  return (process.env.STUDIO_APP_HOST || 'studio.novum-partners.de').toLowerCase();
}

function normalizeHost(host: string | null): string {
  return (host || '').split(':')[0].toLowerCase();
}

function isStudioHost(request: NextRequest): boolean {
  const host = normalizeHost(
    request.headers.get('host')
      || request.headers.get('x-forwarded-host')
  );
  return host === getStudioAppHost();
}

const STUDIO_PUBLIC_ASSET_PATHS = new Set([
  '/canvas.css',
  '/novum-partners-logo-black.png',
  '/swiper-minimal.css',
  '/y-filled.svg',
  '/ycode-webclip.png',
]);

function isReservedStudioPath(pathname: string): boolean {
  return pathname.startsWith('/ycode')
    || pathname.startsWith('/_next')
    || pathname.startsWith('/api')
    || pathname.startsWith('/a/')
    || STUDIO_PUBLIC_ASSET_PATHS.has(pathname)
    || pathname === '/favicon.ico'
    || pathname === '/icon.svg'
    || pathname === '/robots.txt'
    || pathname === '/sitemap.xml'
    || pathname === '/llms.txt';
}

function isStudioAppRequest(request: NextRequest, pathname: string): boolean {
  return isStudioHost(request) && !isReservedStudioPath(pathname);
}

function studioRobotsResponse(): Response {
  return new NextResponse('User-agent: *\nDisallow: /\n', {
    status: 200,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function studioSitemapResponse(): Response {
  return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>', {
    status: 200,
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function getPreviewNonceSecret(): string | null {
  return process.env.STUDIO_PREVIEW_NONCE_SECRET
    || process.env.SUPABASE_SECRET_KEY
    || process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.SUPABASE_DB_PASSWORD
    || null;
}

function encodePreviewUrlForNonce(value: string): string {
  return encodeURIComponent(value).replace(/\./g, '%2E');
}

function encodeNoncePart(value: string): string {
  return encodeURIComponent(value).replace(/\./g, '%2E');
}

function stableStringify(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value !== 'object') return String(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `"${key}":${stableStringify((value as Record<string, unknown>)[key])}`).join(',')}}`;
}

async function sha256Hex(value: unknown): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null;
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(typeof value === 'string' ? value : stableStringify(value)),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function selectDraftFingerprintRows(client: any, table: string, projectId: string): Promise<unknown[]> {
  const hasProjectScope = await tableHasColumn(client, table, 'project_id');
  if (!hasProjectScope && isSharedDbProjectScopeRequired()) {
    throw new Error(`Project scope column is required for ${table}`);
  }
  let query = client
    .from(table)
    .select('*')
    .eq('is_published', false)
    .order('id', { ascending: true });
  if (hasProjectScope) query = query.eq('project_id', projectId);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map((row: Record<string, unknown>) => {
    const { created_at, updated_at, ...stableRow } = row;
    return stableRow;
  });
}

async function computeDraftFingerprint(client: any, projectId: string): Promise<string | null> {
  try {
    const [draftRows, colorVariables, settings] = await Promise.all([
      Promise.all(DRAFT_FINGERPRINT_TABLES.map(async (table) => [
        table,
        await selectDraftFingerprintRows(client, table, projectId),
      ])),
      (async () => {
        const hasProjectScope = await tableHasColumn(client, 'color_variables', 'project_id');
        if (!hasProjectScope && isSharedDbProjectScopeRequired()) {
          throw new Error('Project scope column is required for color_variables');
        }
        let query = client
          .from('color_variables')
          .select('id, name, value, sort_order, updated_at')
          .order('sort_order', { ascending: true })
          .order('id', { ascending: true });
        if (hasProjectScope) query = query.eq('project_id', projectId);
        const { data, error } = await query;
        if (error) throw error;
        return data || [];
      })(),
      (async () => {
        const hasProjectScope = await tableHasColumn(client, 'settings', 'project_id');
        if (!hasProjectScope && isSharedDbProjectScopeRequired()) {
          throw new Error('Project scope column is required for settings');
        }
        let query = client
          .from('settings')
          .select('key, value, updated_at')
          .neq('key', 'published_at')
          .order('key', { ascending: true });
        if (hasProjectScope) query = query.eq('project_id', projectId);
        const { data, error } = await query;
        if (error) throw error;
        return data || [];
      })(),
    ]);
    return sha256Hex({ draftRows: Object.fromEntries(draftRows), colorVariables, settings });
  } catch {
    return null;
  }
}

async function signPreviewNoncePayload(payload: string): Promise<string | null> {
  const secret = getPreviewNonceSecret();
  if (!secret || !globalThis.crypto?.subtle) return null;
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await globalThis.crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function applyPreviewNonceCookie(
  request: NextRequest,
  response: NextResponse,
  previewUrl: string
): Promise<void> {
  const nonceContext = await resolvePreviewNonceContext(request);
  const noncePayload = [
    Date.now(),
    crypto.randomUUID(),
    encodeNoncePart(nonceContext?.siteKey || ''),
    encodeNoncePart(nonceContext?.actorUserId || ''),
    encodeNoncePart(nonceContext?.projectId || ''),
    encodeNoncePart(nonceContext?.draftHash || ''),
    encodePreviewUrlForNonce(previewUrl),
  ].join('.');
  const nonceSignature = await signPreviewNoncePayload(noncePayload);
  if (nonceContext && nonceSignature) {
    response.cookies.set(
      STUDIO_PREVIEW_NONCE_COOKIE,
      `${noncePayload}.${nonceSignature}`,
      {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/ycode',
        maxAge: 30 * 60,
      }
    );
  } else {
    response.cookies.set(STUDIO_PREVIEW_NONCE_COOKIE, '', { path: '/ycode', maxAge: 0 });
  }
}

async function resolvePreviewNonceContext(request: NextRequest): Promise<{
  actorUserId: string;
  projectId: string;
  siteKey: string;
  draftHash: string;
} | null> {
  const config = getSupabaseEnvConfig();
  if (!config) return null;
  const fingerprintClient = config.secretKey
    ? createClient(config.url, config.secretKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    : null;

  let response = NextResponse.next({ request });
  const supabase = createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const siteKey = getCurrentSiteKey();
  const projectSlug = resolveRequestedProjectSlug(request);
  if (projectSlug) {
    const project = await findProjectBySlugOrDomain(supabase, projectSlug);
    if (!project) return null;
    const membershipResult = await supabase
      .from('studio_project_memberships')
      .select('project_id')
      .eq('project_id', project.id)
      .eq('user_id', user.id)
      .maybeSingle();
    if (membershipResult.error || !membershipResult.data) {
      const siteAdminRole = getConfiguredSiteAdminRoleForUser(user);
      if (!siteAdminRole) return null;
    }
    const draftHash = await computeDraftFingerprint(fingerprintClient || supabase, project.id);
    if (!draftHash) return null;
    return { actorUserId: user.id, projectId: project.id, siteKey, draftHash };
  }

  const membershipResult = await supabase
    .from('studio_project_memberships')
    .select('project_id, project:studio_projects(status, ycode_site_key)')
    .eq('user_id', user.id);
  if (membershipResult.error) return null;

  const activeSiteMemberships = (membershipResult.data || []).filter((item: any) => {
    const project = Array.isArray(item.project) ? item.project[0] : item.project;
    return project?.status === 'active';
  });
  if (activeSiteMemberships.length !== 1 || !activeSiteMemberships[0].project_id) return null;
  const draftHash = await computeDraftFingerprint(fingerprintClient || supabase, activeSiteMemberships[0].project_id);
  if (!draftHash) return null;
  return { actorUserId: user.id, projectId: activeSiteMemberships[0].project_id, siteKey, draftHash };
}

async function findProjectBySlugOrDomain(client: any, value: string): Promise<{ id: string } | null> {
  if (!isSafeProjectLookupValue(value)) return null;

  const activeProjects = await client
    .from('studio_projects')
    .select('id, slug, primary_domain, metadata')
    .eq('status', 'active');

  if (activeProjects.error || !Array.isArray(activeProjects.data)) return null;
  const aliasMatches = findStudioProjectPathMatches(activeProjects.data, value);
  const hostMatches = findStudioProjectHostMatches(activeProjects.data, value);

  const bySlug = await client
    .from('studio_projects')
    .select('id')
    .eq('slug', value)
    .eq('status', 'active')
    .maybeSingle();

  if (bySlug.error) return null;
  if (bySlug.data) {
    return bySlug.data;
  }

  const byDomain = await client
    .from('studio_projects')
    .select('id')
    .eq('primary_domain', value)
    .eq('status', 'active')
    .maybeSingle();

  if (byDomain.error) return null;
  if (byDomain.data) return byDomain.data;

  const hostMatch = hostMatches.length === 1 ? hostMatches[0] : null;
  if (hostMatch?.id) return { id: hostMatch.id };

  const match = aliasMatches.length === 1 ? aliasMatches[0] : null;
  return match?.id ? { id: match.id } : null;
}

function getAuditDescriptor(pathname: string, method: string): { action: string; entityType: string } | null {
  if (!isMutatingRequest(method)) return null;

  if (pathname.startsWith('/ycode/api/publish')) {
    return { action: 'site.publish.mutate', entityType: 'site' };
  }
  if (pathname.startsWith('/ycode/api/revert') || pathname.startsWith('/ycode/api/versions')) {
    return { action: 'site.version.mutate', entityType: 'version' };
  }
  if (pathname.startsWith('/ycode/api/studio/preview-approval')) {
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

    await adminClient.from('studio_audit_logs').insert({
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
    console.error('[studio] proxy audit log failed:', error);
  }
}

function resolveRequestedProjectSlug(request: NextRequest): string | null {
  const explicit = request.headers.get('x-studio-project-slug')
    || request.nextUrl.searchParams.get('project');
  if (explicit) return explicit;

  const host = request.headers.get('host') || request.headers.get('x-forwarded-host') || '';
  return projectLookupFromHost(host);
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

function isBuilderOnlyMutation(pathname: string, method: string): boolean {
  return MUTATING_METHODS.includes(method) && BUILDER_ONLY_MUTATION_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function hasSameOriginMutationContext(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  if (origin) {
    try {
      return new URL(origin).origin === request.nextUrl.origin;
    } catch {
      return false;
    }
  }

  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite) {
    return fetchSite === 'same-origin' || fetchSite === 'none';
  }

  const referer = request.headers.get('referer');
  if (!referer) return false;
  try {
    const url = new URL(referer, request.url);
    return url.origin === request.nextUrl.origin;
  } catch {
    return false;
  }
}

/**
 * Verify Supabase session for protected API routes.
 * Returns a 401 response if not authenticated, or null to continue.
 */
async function verifyApiAuth(request: NextRequest): Promise<ApiAuthResult> {
  if (isPublicApiRoute(request.nextUrl.pathname, request.method)) {
    return { ok: true };
  }

  const config = getSupabaseEnvConfig();

  // If env vars aren't set (pre-setup or local dev without .env.local), allow only in non-production.
  // In production this must fail closed to avoid unprotected API access.
  if (!config) {
    if (process.env.NODE_ENV === 'production') {
      return {
        ok: false,
        response: NextResponse.json(
          { error: 'Supabase is not configured' },
          { status: 500 },
        ),
      };
    }
    return { ok: true };
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
  const accessClient = config.secretKey
    ? createClient(config.url, config.secretKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    : authClient;

  const { data: { user } } = await authClient.auth.getUser();

  if (!user) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      ),
    };
  }

  const siteAdminRole = getConfiguredSiteAdminRoleForUser(user);

  if (isDevtoolsRoute(request.nextUrl.pathname) && !areDevtoolsEnabled()) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Not found' },
        { status: 404 }
      ),
    };
  }

  if (AUTH_ONLY_API_EXACT.includes(request.nextUrl.pathname)) {
    return { ok: true };
  }

  const requiredRoles = getRequiredRoles(request.nextUrl.pathname, request.method);

  if (requiredRoles) {
    if (isGlobalSiteAdminRoute(request.nextUrl.pathname)) {
      if (siteAdminRole) return { ok: true };
      return {
        ok: false,
        response: NextResponse.json(
          { error: 'Insufficient site admin role' },
          { status: 403 }
        ),
      };
    }

    if (isSharedDbProjectScopeRequired()) {
      const isolation = await checkProjectIsolation(accessClient);
      if (!isolation.enabled) {
        return {
          ok: false,
          response: NextResponse.json(
            {
              error: 'Project isolation schema is not enabled',
              code: 'STUDIO_PROJECT_SCOPE_REQUIRED',
              missingTables: isolation.missingTables,
            },
            { status: 409 }
          ),
        };
      }

      if (!isProjectScopedApiVerified()) {
        return {
          ok: false,
          response: NextResponse.json(
            {
              error: 'Project-scoped API handlers are not fully verified',
              code: 'STUDIO_PROJECT_SCOPED_API_NOT_VERIFIED',
            },
            { status: 409 }
          ),
        };
      }
    }

    const projectSlug = resolveRequestedProjectSlug(request);
    let membership: { role: string; project_id?: string } | null = null;
    let resolvedProjectId: string | null = null;
    let membershipError: { message?: string } | null = null;

    if (projectSlug) {
      const project = await findProjectBySlugOrDomain(accessClient, projectSlug);

      if (!project) {
        return {
          ok: false,
          response: NextResponse.json(
            { error: 'No assigned Studio project resolved' },
            { status: 403 }
          ),
        };
      }

      const membershipResult = await accessClient
        .from('studio_project_memberships')
        .select('role, project_id')
        .eq('project_id', project.id)
        .eq('user_id', user.id)
        .maybeSingle();
      membership = membershipResult.data;
      membershipError = membershipResult.error;
      resolvedProjectId = project.id;

      if (siteAdminRole) {
        membership = { role: siteAdminRole, project_id: project.id };
      }
    } else {
      if (siteAdminRole) {
        return {
          ok: false,
          response: NextResponse.json(
            { error: 'Project selection required' },
            { status: 403 }
          ),
        };
      }

      const membershipResult = await accessClient
        .from('studio_project_memberships')
        .select('role, project_id, project:studio_projects(status, ycode_site_key)')
        .eq('user_id', user.id);

      const activeSiteMemberships = (membershipResult.data || []).filter((item: any) => {
        const project = Array.isArray(item.project) ? item.project[0] : item.project;
        return project?.status === 'active';
      });

      if (membershipResult.error || activeSiteMemberships.length !== 1) {
        return {
          ok: false,
          response: NextResponse.json(
            { error: 'Project selection required' },
            { status: 403 }
          ),
        };
      }

      membership = activeSiteMemberships[0];
      membershipError = null;
      resolvedProjectId = membership.project_id || null;
    }

    const normalizedMembershipRole = normalizeStudioRole(membership?.role);
    if (membershipError || !normalizedMembershipRole || !hasAllowedStudioRole(normalizedMembershipRole, requiredRoles)) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: 'Insufficient project role' },
          { status: 403 }
        ),
      };
    }

    await writeProxyAuditLog({
      config,
      projectId: resolvedProjectId,
      actorUserId: user.id,
      role: normalizedMembershipRole,
      request,
    });

    const requestHeaders = new Headers(request.headers);
    if (resolvedProjectId) {
      requestHeaders.set('x-studio-project-id', resolvedProjectId);
    }
    if (projectSlug) {
      requestHeaders.set('x-studio-project-slug', projectSlug);
    }

    return { ok: true, requestHeaders };
  }

  return { ok: true };
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  let forwardedRequestHeaders: Headers | undefined;

  if (isStudioHost(request) && pathname === '/robots.txt') {
    return studioRobotsResponse();
  }

  if (isStudioHost(request) && pathname === '/sitemap.xml') {
    return studioSitemapResponse();
  }

  if (isStudioAppRequest(request, pathname)) {
    const segments = pathname.split('/').filter(Boolean);
    const projectPathSlug = segments[0] || '';
    const routeSuffix = segments.slice(1).join('/');
    const rewriteUrl = request.nextUrl.clone();
    rewriteUrl.pathname = routeSuffix ? `/ycode/${routeSuffix}` : '/ycode';
    const isProjectPrefixedPreview = rewriteUrl.pathname.startsWith('/ycode/preview');
    if (isProjectPrefixedPreview && projectPathSlug) {
      rewriteUrl.searchParams.set('project', projectPathSlug);
    }

    let requestHeaders = new Headers(request.headers);
    if (projectPathSlug) {
      requestHeaders.set('x-studio-project-slug', projectPathSlug);
    }

    const rewrittenRequest = new NextRequest(rewriteUrl, {
      headers: requestHeaders,
      method: request.method,
    });

    if (rewriteUrl.pathname.startsWith('/ycode/api') || rewriteUrl.pathname.startsWith('/ycode/preview')) {
      const authResult = await verifyApiAuth(rewrittenRequest);
      if (!authResult.ok) {
        if (isProjectPrefixedPreview) {
          const redirect = NextResponse.redirect(new URL(projectPathSlug ? `/${projectPathSlug}` : '/ycode', request.url));
          redirect.cookies.set(STUDIO_PREVIEW_NONCE_COOKIE, '', { path: '/ycode', maxAge: 0 });
          return redirect;
        }
        return authResult.response;
      }
      requestHeaders = authResult.requestHeaders || requestHeaders;
    }

    if (isBuilderOnlyMutation(rewriteUrl.pathname, request.method) && !hasSameOriginMutationContext(rewrittenRequest)) {
      return NextResponse.json(
        { error: 'This Studio action must be initiated from the same origin.' },
        { status: 403 }
      );
    }

    const response = NextResponse.rewrite(rewriteUrl, {
      request: { headers: requestHeaders },
    });
    response.headers.set('x-pathname', rewriteUrl.pathname);
    if (projectPathSlug) {
      response.headers.set('x-studio-project-slug', projectPathSlug);
    }
    if (isProjectPrefixedPreview && request.method === 'GET') {
      const canonicalPreviewUrl = new URL(`${rewriteUrl.pathname}${rewriteUrl.search}`, request.url);
      if (projectPathSlug) {
        canonicalPreviewUrl.searchParams.set('project', projectPathSlug);
      }
      await applyPreviewNonceCookie(
        rewrittenRequest,
        response,
        `${canonicalPreviewUrl.pathname}${canonicalPreviewUrl.search}`
      );
    }
    return response;
  }

  // MCP endpoint uses its own token-based authentication — skip session auth.
  // Cloud overlay proxies MUST also exempt this path to avoid login redirects.
  if (pathname.startsWith('/ycode/mcp/')) {
    const response = NextResponse.next();
    response.headers.set('x-pathname', pathname);
    return response;
  }

  // Protect API and preview routes with auth
  if (pathname.startsWith('/ycode/api') || pathname.startsWith('/ycode/preview')) {
    const authResult = await verifyApiAuth(request);
    if (!authResult.ok) {
      if (pathname.startsWith('/ycode/preview')) {
        const redirect = NextResponse.redirect(new URL('/ycode', request.url));
        redirect.cookies.set(STUDIO_PREVIEW_NONCE_COOKIE, '', { path: '/ycode', maxAge: 0 });
        return redirect;
      }
      return authResult.response;
    }
    forwardedRequestHeaders = authResult.requestHeaders;
  }

  if (isBuilderOnlyMutation(pathname, request.method) && !hasSameOriginMutationContext(request)) {
    return NextResponse.json(
      { error: 'This Studio action must be initiated from the same origin.' },
      { status: 403 }
    );
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
  const response = forwardedRequestHeaders
    ? NextResponse.next({ request: { headers: forwardedRequestHeaders } })
    : NextResponse.next();

  // Add pathname header for layout to determine dark mode
  response.headers.set('x-pathname', pathname);

  if (pathname.startsWith('/ycode/preview') && request.method === 'GET') {
    await applyPreviewNonceCookie(request, response, `${pathname}${request.nextUrl.search}`);
  }

  if (isPublicPage && request.method === 'GET') {
    response.headers.set('Cache-Control', 'public, s-maxage=31536000, stale-while-revalidate=31536000');
  }

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
