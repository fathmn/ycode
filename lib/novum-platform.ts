import crypto from 'crypto';
import type { NextRequest } from 'next/server';
import { noCache } from '@/lib/api-response';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { extractSupabaseAccessToken } from '@/lib/supabase-cookie-token';
import { NOVUM_PREVIEW_NONCE_COOKIE } from '@/lib/novum-preview-nonce';
import { getAuthUser } from '@/lib/supabase-auth';

const PREVIEW_MAX_AGE_HOURS = Number(process.env.NOVUM_PREVIEW_MAX_AGE_HOURS || 24);
const PREVIEW_NONCE_MAX_AGE_MINUTES = Number(process.env.NOVUM_PREVIEW_NONCE_MAX_AGE_MINUTES || 30);
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

type NovumRole = 'novum_admin' | 'novum_developer' | 'customer_owner' | 'customer_editor' | 'customer_viewer';

type NovumProject = {
  id: string;
  slug: string;
};

type NovumContext = {
  client: any;
  project: NovumProject;
  actorUserId: string;
  role: NovumRole;
};

type AuditInput = {
  request?: NextRequest;
  action: string;
  entityType: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
};

type CodeSnippet = {
  scope: 'global' | 'page' | 'embed';
  targetId?: string;
  content: string;
};

type CustomCodeMutationInput = {
  scope: 'global' | 'page' | 'component' | 'embed';
  targetId?: string;
  content: string;
  metadata?: Record<string, unknown>;
};

function isSafeProjectLookupValue(value: string): boolean {
  return /^[a-z0-9][a-z0-9.-]{0,252}[a-z0-9]$/i.test(value);
}

function getCurrentSiteKey(): string {
  return process.env.STUDIO_YCODE_SITE_KEY || 'default';
}

export async function requireNovumProjectRole(
  request: NextRequest,
  allowedRoles: NovumRole[]
): Promise<{ ok: true; context: NovumContext } | { ok: false; response: Response }> {
  const client = await getSupabaseAdmin();
  if (!client) {
    return { ok: false, response: noCache({ error: 'Supabase is not configured' }, 500) };
  }

  const actorUserId = await resolveActorUserId(client, request);
  if (!actorUserId) {
    return { ok: false, response: noCache({ error: 'Not authenticated' }, 401) };
  }

  const project = await resolveProjectForRequest(client, request, actorUserId);
  if (!project) {
    return { ok: false, response: noCache({ error: 'No Novum project resolved for request' }, 403) };
  }

  const { data: membership, error } = await client
    .from('novum_project_memberships')
    .select('role')
    .eq('project_id', project.id)
    .eq('user_id', actorUserId)
    .maybeSingle();

  if (error || !membership || !allowedRoles.includes(membership.role)) {
    return { ok: false, response: noCache({ error: 'Insufficient project role' }, 403) };
  }

  return {
    ok: true,
    context: {
      client,
      project,
      actorUserId,
      role: membership.role,
    },
  };
}

async function requireNovumProjectRoleForProject(
  request: NextRequest,
  projectId: string,
  allowedRoles: NovumRole[]
): Promise<{ ok: true; context: NovumContext } | { ok: false; response: Response }> {
  const client = await getSupabaseAdmin();
  if (!client) {
    return { ok: false, response: noCache({ error: 'Supabase is not configured' }, 500) };
  }

  const actorUserId = await resolveActorUserId(client, request);
  if (!actorUserId) {
    return { ok: false, response: noCache({ error: 'Not authenticated' }, 401) };
  }

  const project = await getProjectById(client, projectId);
  if (!project) {
    return { ok: false, response: noCache({ error: 'No Novum project resolved for request' }, 403) };
  }

  const { data: membership, error } = await client
    .from('novum_project_memberships')
    .select('role')
    .eq('project_id', project.id)
    .eq('user_id', actorUserId)
    .maybeSingle();

  if (error || !membership || !allowedRoles.includes(membership.role)) {
    return { ok: false, response: noCache({ error: 'Insufficient project role' }, 403) };
  }

  return {
    ok: true,
    context: {
      client,
      project,
      actorUserId,
      role: membership.role,
    },
  };
}

export async function canAccessNovumProject(
  projectId: string,
  allowedRoles: NovumRole[] = ['novum_admin', 'novum_developer', 'customer_owner', 'customer_editor', 'customer_viewer']
): Promise<boolean> {
  const auth = await getAuthUser();
  if (!auth?.user?.id) return false;
  return canAccessNovumProjectForUser(projectId, auth.user.id, allowedRoles);
}

export async function canAccessNovumProjectForUser(
  projectId: string,
  actorUserId: string,
  allowedRoles: NovumRole[] = ['novum_admin', 'novum_developer', 'customer_owner', 'customer_editor', 'customer_viewer']
): Promise<boolean> {
  if (!actorUserId) return false;
  const client = await getSupabaseAdmin();
  if (!client) return false;

  const project = await getProjectById(client, projectId);
  if (!project) return false;

  const { data: membership, error } = await client
    .from('novum_project_memberships')
    .select('role')
    .eq('project_id', project.id)
    .eq('user_id', actorUserId)
    .maybeSingle();

  return !error && !!membership && allowedRoles.includes(membership.role);
}

export async function writeNovumAuditLog(input: AuditInput): Promise<void> {
  try {
    const client = await getSupabaseAdmin();
    if (!client) return;

    const actorUserId = input.request ? await resolveActorUserId(client, input.request) : null;
    const project = input.request && actorUserId
      ? await resolveProjectForRequest(client, input.request, actorUserId)
      : null;
    if (!project) return;

    await client.from('novum_audit_logs').insert({
      project_id: project.id,
      actor_user_id: actorUserId,
      action: input.action,
      entity_type: input.entityType,
      entity_id: input.entityId || project.slug,
      metadata: input.metadata || {},
    });
  } catch (error) {
    console.error('[novum] audit log failed:', error);
  }
}

export async function recordNovumCustomCodeMutation(
  request: NextRequest,
  input: CustomCodeMutationInput
): Promise<void> {
  try {
    const client = await getSupabaseAdmin();
    if (!client) return;

    const actorUserId = await resolveActorUserId(client, request);
    if (!actorUserId) return;

    const project = await resolveProjectForRequest(client, request, actorUserId);
    if (!project) return;

    const contentHash = crypto.createHash('sha256').update(input.content || '').digest('hex');
    const findings = scanForSecrets(input.content || '');
    const secretScanStatus = findings.length > 0 ? 'blocked' : 'clean';

    await client.from('novum_custom_code_events').insert({
      project_id: project.id,
      actor_user_id: actorUserId,
      scope: input.scope,
      target_id: input.targetId || null,
      content_hash: contentHash,
      secret_scan_status: secretScanStatus,
      secret_scan_findings: findings,
      preview_required: true,
      metadata: {
        ...(input.metadata || {}),
        bytes: Buffer.byteLength(input.content || ''),
        source: 'custom_code_save',
      },
    });

    await client.from('novum_audit_logs').insert({
      project_id: project.id,
      actor_user_id: actorUserId,
      action: findings.length > 0 ? 'custom_code.changed.secret_detected' : 'custom_code.changed',
      entity_type: 'custom_code',
      entity_id: input.targetId || input.scope,
      metadata: {
        ...(input.metadata || {}),
        scope: input.scope,
        contentHash,
        secretScanStatus,
        findings,
        previewRequired: true,
        source: 'custom_code_save',
      },
    });
  } catch (error) {
    console.error('[novum] custom code mutation audit failed:', error);
  }
}

export async function verifyNovumPublishGate(request: NextRequest): Promise<
  | { ok: true; context: NovumContext; draftHash: string; customCode: CustomCodeScanResult }
  | { ok: false; response: Response }
> {
  const roleCheck = await requireNovumProjectRole(request, [
    'novum_admin',
    'novum_developer',
    'customer_owner',
  ]);
  if (!roleCheck.ok) return roleCheck;

  const { context } = roleCheck;
  const readiness = getNovumPublishReadiness();
  if (!readiness.livePublishAvailable) {
    await writeNovumAuditLog({
      request,
      action: 'site.publish.blocked.project_scoped_publish_required',
      entityType: 'site',
      entityId: context.project.slug,
      metadata: {
        projectId: context.project.id,
        reason: 'project_scoped_publish_not_available',
        readiness,
      },
    });
    return {
      ok: false,
      response: noCache(
        {
          error: readiness.blockerMessage,
          code: readiness.blockerCode,
          readiness,
        },
        409
      ),
    };
  }

  const draftHash = await getCurrentDraftHash(context.client, context.project.id);
  const previewOk = await hasValidPreviewApproval(context.client, context.project.id, draftHash);
  if (!previewOk) {
    await writeNovumAuditLog({
      request,
      action: 'site.publish.blocked.preview_required',
      entityType: 'site',
      entityId: context.project.slug,
      metadata: { draftHash, maxAgeHours: PREVIEW_MAX_AGE_HOURS },
    });
    return {
      ok: false,
      response: noCache(
        {
          error: 'Preview required before publishing',
          code: 'NOVUM_PREVIEW_REQUIRED',
          draftHash,
        },
        409
      ),
    };
  }

  const customCode = await scanNovumCustomCode(context.client, context.project.id);

  if (customCode.secret_scan_status === 'blocked') {
    await writeNovumAuditLog({
      request,
      action: 'site.publish.blocked.custom_code_secret',
      entityType: 'site',
      entityId: context.project.slug,
      metadata: {
        draftHash,
        contentHash: customCode.content_hash,
        findings: customCode.secret_scan_findings,
      },
    });
    return {
      ok: false,
      response: noCache(
        {
          error: 'Custom code contains possible secrets and cannot be published',
          code: 'NOVUM_CUSTOM_CODE_SECRET_BLOCKED',
          findings: customCode.secret_scan_findings,
        },
        409
      ),
    };
  }

  return { ok: true, context, draftHash, customCode };
}

export async function recordExplicitNovumPreviewApproval(request: NextRequest): Promise<Response> {
  const body = await request.json().catch(() => ({}));
  const previewUrl = normalizePreviewUrl(body.previewUrl || '/ycode/preview');
  if (!previewUrl) {
    return noCache(
      {
        error: 'Invalid preview URL',
        code: 'NOVUM_PREVIEW_URL_INVALID',
      },
      400
    );
  }

  const roleCheck = await requireNovumProjectRole(request, [
    'novum_admin',
    'novum_developer',
    'customer_owner',
    'customer_editor',
  ]);
  if (!roleCheck.ok) return roleCheck.response;

  const { context } = roleCheck;
  const draftHash = await getCurrentDraftHash(context.client, context.project.id);
  const renderedPreview = await getRecentRenderedPreview(
    context.client,
    context.project.id,
    context.actorUserId,
    draftHash,
    previewUrl
  );

  if (!renderedPreview) {
    return noCache(
      {
        error: 'Open and verify this Studio preview before approving the draft for publish',
        code: 'NOVUM_PREVIEW_RENDER_REQUIRED',
        projectId: context.project.id,
        projectSlug: context.project.slug,
        previewUrl,
        draftHash,
        maxAgeHours: PREVIEW_MAX_AGE_HOURS,
      },
      409
    );
  }

  const metadata = {
    explicitApproval: true,
    renderedPreviewRunId: renderedPreview.id,
    previewUrl: renderedPreview.preview_url,
    role: context.role,
    maxAgeHours: PREVIEW_MAX_AGE_HOURS,
    source: 'studio_preview_approval',
  };

  const { data, error } = await context.client
    .from('novum_preview_runs')
    .insert({
      project_id: context.project.id,
      actor_user_id: context.actorUserId,
      source: 'studio_preview_approval',
      preview_url: renderedPreview.preview_url,
      draft_hash: draftHash,
      status: 'created',
      metadata,
    })
    .select('id, preview_url, draft_hash, created_at')
    .single();

  if (error) return noCache({ error: error.message }, 500);

  await context.client.from('novum_audit_logs').insert({
    project_id: context.project.id,
    actor_user_id: context.actorUserId,
    action: 'site.preview.approved',
    entity_type: 'site',
    entity_id: context.project.slug,
    metadata: {
      ...metadata,
      approvalPreviewRunId: data.id,
      draftHash,
    },
  });

  return noCache({ data });
}

export async function recordNovumPreviewRendered(request: NextRequest): Promise<Response> {
  const body = await request.json().catch(() => ({}));
  const previewUrl = normalizePreviewUrl(body.previewUrl);
  if (!previewUrl) {
    return noCache(
      {
        error: 'Invalid preview URL',
        code: 'NOVUM_PREVIEW_URL_INVALID',
      },
      400
    );
  }
  const clientHeartbeat = body?.clientHeartbeat;
  const clientHeartbeatOk = Boolean(
    clientHeartbeat
    && typeof clientHeartbeat === 'object'
    && clientHeartbeat.ok === true
    && clientHeartbeat.bodyVisible === true
    && Number(clientHeartbeat.bodyWidth) > 0
    && Number(clientHeartbeat.bodyHeight) > 0
    && Number(clientHeartbeat.visibleLayerCount) > 0
    && Number(clientHeartbeat.contentLayerCount) > 0
  );
  if (!clientHeartbeatOk) {
    return noCache(
      {
        error: 'Rendered preview client heartbeat is incomplete',
        code: 'NOVUM_PREVIEW_CLIENT_HEARTBEAT_INVALID',
      },
      409
    );
  }

  const previewNonce = parsePreviewNonce(request.cookies.get(NOVUM_PREVIEW_NONCE_COOKIE)?.value || '');
  if (!previewNonce || previewNonce.previewUrl !== previewUrl || previewNonce.siteKey !== getCurrentSiteKey()) {
    return noCache(
      {
        error: 'Open this Studio preview before recording a rendered draft',
        code: 'NOVUM_PREVIEW_RENDER_REQUIRED',
      },
      409
    );
  }

  const roleCheck = await requireNovumProjectRoleForProject(request, previewNonce.projectId, [
    'novum_admin',
    'novum_developer',
    'customer_owner',
    'customer_editor',
  ]);
  if (!roleCheck.ok) return roleCheck.response;

  const { context } = roleCheck;
  if (previewNonce.actorUserId !== context.actorUserId || previewNonce.projectId !== context.project.id) {
    return noCache(
      {
        error: 'Open this Studio preview before recording a rendered draft',
        code: 'NOVUM_PREVIEW_RENDER_REQUIRED',
      },
      409
    );
  }

  const currentDraftFingerprint = await getCurrentDraftFingerprint(context.client, context.project.id);
  if (currentDraftFingerprint !== previewNonce.draftHash) {
    return noCache(
      {
        error: 'Open this Studio preview again before recording a rendered draft',
        code: 'NOVUM_PREVIEW_RENDER_REQUIRED',
      },
      409
    );
  }

  const draftHash = await getCurrentDraftHash(context.client, context.project.id);
  const rawNonceHash = hashPreviewNonce(previewNonce.raw);
  const previewNonceHash = crypto
    .createHash('sha256')
    .update([
      previewNonce.raw,
      context.project.id,
      context.actorUserId,
      draftHash,
      previewUrl,
    ].join(':'))
    .digest('hex');
  const trustedMetadata = {
    clientHeartbeat: true,
    clientHeartbeatMetrics: clientHeartbeat,
    rawNonceHash,
    role: context.role,
    previewNonceHash,
    previewNonceDraftHash: previewNonce.draftHash,
    previewNonceIssuedAt: new Date(previewNonce.issuedAt).toISOString(),
    clientVisibilityProof: true,
    serverSideRenderProof: true,
    renderArtifact: {
      kind: 'studio-preview-nonce-heartbeat',
      reportPath: previewUrl,
      generatedAt: new Date().toISOString(),
      pairCount: Number(clientHeartbeat.visibleLayerCount) || 1,
      failingPairs: [],
      previewNonceHash,
      draftHash,
    },
  };

  const { data, error } = await context.client
    .from('novum_preview_runs')
    .insert({
      project_id: context.project.id,
      actor_user_id: context.actorUserId,
      source: 'ycode_preview',
      preview_url: previewUrl,
      draft_hash: draftHash,
      status: 'created',
      metadata: trustedMetadata,
    })
    .select('id, preview_url, draft_hash, created_at')
    .single();

  if (error) {
    if (error.code === '23505') {
      return noCache(
        {
          error: 'Open this Studio preview again before recording a rendered draft',
          code: 'NOVUM_PREVIEW_RENDER_REQUIRED',
        },
        409
      );
    }
    return noCache({ error: error.message }, 500);
  }

  return noCache({ data });
}

type CustomCodeScanResult = {
  content_hash: string | null;
  secret_scan_status: 'clean' | 'blocked';
  secret_scan_findings: Array<{ kind: string; match: string }>;
  snippets_count: number;
};

async function scanNovumCustomCode(client: any, projectId: string, isPublished = false): Promise<CustomCodeScanResult & { snippets: CodeSnippet[] }> {
  const snippets = await collectCustomCodeSnippets(client, projectId, isPublished);
  const combined = snippets.map((item) => `${item.scope}:${item.targetId || ''}:${item.content}`).join('\n---\n');

  if (!combined.trim()) {
    return {
      content_hash: null,
      secret_scan_status: 'clean',
      secret_scan_findings: [],
      snippets_count: 0,
      snippets: [],
    };
  }

  const findings = scanForSecrets(combined);
  return {
    content_hash: crypto.createHash('sha256').update(combined).digest('hex'),
    secret_scan_status: findings.length > 0 ? 'blocked' : 'clean',
    secret_scan_findings: findings,
    snippets_count: snippets.length,
    snippets,
  };
}

export async function canRenderNovumCustomCode(
  projectId?: string | null,
  isPublished = false,
  options: { requireProject?: boolean } = {}
): Promise<boolean> {
  if (!projectId) return options.requireProject === true ? false : true;

  const client = await getSupabaseAdmin();
  if (!client) return false;

  try {
    const scan = await scanNovumCustomCode(client, projectId, isPublished);
    return scan.secret_scan_status === 'clean';
  } catch {
    return false;
  }
}

async function recordNovumCustomCodeSnapshot(input: {
  client: any;
  project: NovumProject;
  actorUserId: string;
}): Promise<CustomCodeScanResult> {
  const scan = await scanNovumCustomCode(input.client, input.project.id);
  if (!scan.content_hash) return scan;

  await input.client.from('novum_custom_code_events').insert({
    project_id: input.project.id,
    actor_user_id: input.actorUserId,
    scope: 'global',
    target_id: 'combined-custom-code',
    content_hash: scan.content_hash,
    secret_scan_status: scan.secret_scan_status,
    secret_scan_findings: scan.secret_scan_findings,
    preview_required: true,
    preview_checked_at: new Date().toISOString(),
    metadata: {
      snippets: scan.snippets.map(({ scope, targetId, content }) => ({
        scope,
        targetId,
        bytes: Buffer.byteLength(content),
      })),
    },
  });

  const { snippets: _snippets, ...result } = scan;
  return result;
}

async function resolveProjectForRequest(client: any, request: NextRequest, actorUserId: string): Promise<NovumProject | null> {
  const explicitProject = request.headers.get('x-novum-project-slug') || request.nextUrl.searchParams.get('project');
  if (explicitProject) return getProjectByDomainOrSlug(client, explicitProject);

  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || '';
  const hostname = host.split(':')[0];
  if (hostname && hostname !== 'localhost' && hostname !== '127.0.0.1') {
    const byDomain = await getProjectByDomainOrSlug(client, hostname);
    if (byDomain) return byDomain;
  }

  return getSingleProjectByMembership(client, actorUserId);
}

async function getProjectBySlug(client: any, slug: string): Promise<NovumProject | null> {
  if (!isSafeProjectLookupValue(slug)) return null;

  const { data, error } = await client
    .from('novum_projects')
    .select('id, slug')
    .eq('slug', slug)
    .eq('status', 'active')
    .eq('ycode_site_key', getCurrentSiteKey())
    .maybeSingle();

  if (error || !data) return null;
  return data;
}

async function getProjectById(client: any, projectId: string): Promise<NovumProject | null> {
  if (!/^[a-f0-9-]{36}$/i.test(projectId)) return null;

  const { data, error } = await client
    .from('novum_projects')
    .select('id, slug')
    .eq('id', projectId)
    .eq('status', 'active')
    .eq('ycode_site_key', getCurrentSiteKey())
    .maybeSingle();

  if (error || !data) return null;
  return data;
}

async function getProjectByDomainOrSlug(client: any, value: string): Promise<NovumProject | null> {
  if (!isSafeProjectLookupValue(value)) return null;

  const bySlug = await client
    .from('novum_projects')
    .select('id, slug')
    .eq('slug', value)
    .eq('status', 'active')
    .eq('ycode_site_key', getCurrentSiteKey())
    .maybeSingle();

  if (bySlug.error) return null;
  if (bySlug.data) return bySlug.data;

  const byDomain = await client
    .from('novum_projects')
    .select('id, slug')
    .eq('primary_domain', value)
    .eq('status', 'active')
    .eq('ycode_site_key', getCurrentSiteKey())
    .maybeSingle();

  if (byDomain.error || !byDomain.data) return null;
  return byDomain.data;
}

async function getSingleProjectByMembership(client: any, actorUserId: string): Promise<NovumProject | null> {
  const { data, error } = await client
    .from('novum_project_memberships')
    .select('project:novum_projects(id, slug, status, ycode_site_key)')
    .eq('user_id', actorUserId);

  if (error || !Array.isArray(data)) return null;
  const matchingMemberships = data.filter((membership: any) => {
    const project = Array.isArray(membership.project) ? membership.project[0] : membership.project;
    return project?.status === 'active' && project?.ycode_site_key === getCurrentSiteKey();
  });
  if (matchingMemberships.length !== 1) return null;

  const project = Array.isArray(matchingMemberships[0].project)
    ? matchingMemberships[0].project[0]
    : matchingMemberships[0].project;
  return project?.id && project?.slug ? project : null;
}

async function resolveActorUserId(client: any, request?: NextRequest): Promise<string | null> {
  const bearer = request?.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  const cookieToken = request ? extractSupabaseAccessToken(request) : null;
  const token = bearer || cookieToken;
  if (!token) return null;

  const { data, error } = await client.auth.getUser(token);
  if (error) return null;
  return data.user?.id || null;
}

async function getCurrentDraftHash(client: any, projectId: string): Promise<string> {
  const [
    pageFolders,
    pages,
    pageLayers,
    collections,
    collectionFields,
    collectionItems,
    collectionItemValues,
    components,
    layerStyles,
    assetFolders,
    assets,
    fonts,
    colorVariables,
    locales,
    translations,
    settings,
  ] = await Promise.all([
    selectDraftRows(client, 'page_folders', projectId),
    selectDraftRows(client, 'pages', projectId),
    selectDraftRows(client, 'page_layers', projectId),
    selectDraftRows(client, 'collections', projectId),
    selectDraftRows(client, 'collection_fields', projectId),
    selectDraftRows(client, 'collection_items', projectId),
    selectDraftRows(client, 'collection_item_values', projectId),
    selectDraftRows(client, 'components', projectId),
    selectDraftRows(client, 'layer_styles', projectId),
    selectDraftRows(client, 'asset_folders', projectId),
    selectDraftRows(client, 'assets', projectId),
    selectDraftRows(client, 'fonts', projectId),
    selectColorVariableRows(client, projectId),
    selectDraftRows(client, 'locales', projectId),
    selectDraftRows(client, 'translations', projectId),
    selectSettingsRows(client, projectId),
  ]);

  const payload = {
    pageFolders,
    pages,
    pageLayers,
    collections,
    collectionFields,
    collectionItems,
    collectionItemValues,
    components,
    layerStyles,
    assetFolders,
    assets,
    fonts,
    colorVariables,
    locales,
    translations,
    settings,
  };

  return crypto.createHash('sha256').update(stableStringify(payload)).digest('hex');
}

async function getCurrentDraftFingerprint(client: any, projectId: string): Promise<string> {
  const [draftRows, colorVariables, settings] = await Promise.all([
    Promise.all(DRAFT_FINGERPRINT_TABLES.map(async (tableName) => [
      tableName,
      await selectDraftFingerprintRows(client, tableName, projectId),
    ])),
    selectColorVariableRows(client, projectId),
    selectSettingsRows(client, projectId),
  ]);

  return crypto.createHash('sha256').update(stableStringify({
    draftRows: Object.fromEntries(draftRows),
    colorVariables,
    settings,
  })).digest('hex');
}

function isProjectScopeRequired(): boolean {
  return process.env.STUDIO_REQUIRE_SHARED_DB_PROJECT_SCOPE === '1';
}

function allowGlobalPublishEscapeHatch(): boolean {
  return process.env.STUDIO_ALLOW_GLOBAL_PUBLISH === '1';
}

function hasTrustedPreviewRenderProof(): boolean {
  return process.env.STUDIO_TRUSTED_PREVIEW_RENDER_PROOF === '1';
}

function isProjectScopedLivePublishVerified(): boolean {
  return process.env.STUDIO_PROJECT_SCOPED_LIVE_PUBLISH_VERIFIED === '1';
}

export function getNovumPublishReadiness() {
  const projectScopeRequired = isProjectScopeRequired();
  const globalPublishAllowed = allowGlobalPublishEscapeHatch();
  const trustedPreviewRenderProof = hasTrustedPreviewRenderProof();
  const projectScopedPublishConfigured = process.env.STUDIO_PROJECT_SCOPED_LIVE_PUBLISH === '1';
  const projectScopedPublishAvailable = projectScopedPublishConfigured && isProjectScopedLivePublishVerified();
  const livePublishAvailable = projectScopedPublishAvailable && trustedPreviewRenderProof;
  return {
    livePublishAvailable,
    projectScopedPublishConfigured,
    projectScopedPublishAvailable,
    projectScopedPublishVerified: isProjectScopedLivePublishVerified(),
    projectScopeRequired,
    globalPublishAllowed,
    trustedPreviewRenderProof,
    blockerCode: livePublishAvailable ? null : 'NOVUM_PROJECT_SCOPED_PUBLISH_REQUIRED',
    blockerMessage: livePublishAvailable
      ? null
      : !trustedPreviewRenderProof
        ? 'Live-Schaltung ist blockiert, bis eine serverseitig verifizierte Preview-Prüfung verfügbar ist.'
        : projectScopedPublishConfigured
          ? 'Live-Schaltung ist blockiert: projektgebundenes Publishing ist konfiguriert, aber die aktuelle Ycode-Publish-Route ist noch global.'
          : globalPublishAllowed
            ? 'Live-Schaltung bleibt trotz Global-Publish-Escape-Hatch blockiert, bis der Studio-Publish-Pfad projektgebunden ist.'
            : 'Live-Schaltung ist blockiert, bis projektgebundenes Publishing verfügbar ist.',
  };
}

export async function getNovumPublishReadinessForRequest(request: NextRequest): Promise<Response> {
  const roleCheck = await requireNovumProjectRole(request, [
    'novum_admin',
    'novum_developer',
    'customer_owner',
    'customer_editor',
  ]);
  if (!roleCheck.ok) return roleCheck.response;

  const { context } = roleCheck;
  const readiness = getNovumPublishReadiness();
  const draftHash = await getCurrentDraftHash(context.client, context.project.id);
  const previewApproved = await hasValidPreviewApproval(context.client, context.project.id, draftHash);
  const customCode = await scanNovumCustomCode(context.client, context.project.id);
  const customCodeBlocked = customCode.secret_scan_status === 'blocked';

  return noCache({
    data: {
      ...readiness,
      projectId: context.project.id,
      projectSlug: context.project.slug,
      draftHash,
      previewApproved,
      customCodeBlocked,
      customCodeSnippetsCount: customCode.snippets_count,
      livePublishAvailable: readiness.livePublishAvailable && previewApproved && !customCodeBlocked,
      blockerCode: readiness.livePublishAvailable
        ? !previewApproved
          ? 'NOVUM_PREVIEW_REQUIRED'
          : customCodeBlocked
            ? 'NOVUM_CUSTOM_CODE_SECRET_BLOCKED'
            : null
        : readiness.blockerCode,
      blockerMessage: readiness.livePublishAvailable
        ? !previewApproved
          ? 'Preview-Freigabe für den aktuellen Entwurf fehlt.'
          : customCodeBlocked
            ? 'Custom Code enthält mögliche Secrets und muss vor der Live-Schaltung bereinigt werden.'
            : null
        : readiness.blockerMessage,
    },
  });
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

const projectScopeColumnCache = new Set<string>();

async function tableHasProjectScopeColumn(client: any, tableName: string): Promise<boolean> {
  if (projectScopeColumnCache.has(tableName)) {
    return true;
  }
  const { error } = await client.from(tableName).select('project_id').limit(0);
  if (!error) {
    projectScopeColumnCache.add(tableName);
    return true;
  }
  if (isProjectScopeRequired() && !isMissingColumnError(error)) {
    throw new Error(`Failed to inspect project scope for ${tableName}: ${error.message}`);
  }
  return false;
}

async function applyOptionalProjectScope(query: any, client: any, tableName: string, projectId: string) {
  const hasProjectScope = await tableHasProjectScopeColumn(client, tableName);
  if (!hasProjectScope) {
    if (isProjectScopeRequired()) {
      throw new Error(`Project scope column is required for ${tableName}`);
    }
    return query;
  }
  return query.eq('project_id', projectId);
}

async function selectDraftRows(client: any, tableName: string, projectId: string): Promise<unknown[]> {
  const hasProjectScope = await tableHasProjectScopeColumn(client, tableName);
  if (hasProjectScope) {
    const { data, error } = await client
      .from(tableName)
      .select('*')
      .eq('is_published', false)
      .eq('project_id', projectId)
      .order('id', { ascending: true });

    if (error) {
      throw new Error(`Failed to hash draft table ${tableName}: ${error.message}`);
    }
    return normalizeDraftRows(data || []);
  }

  if (isProjectScopeRequired()) {
    throw new Error(`Failed to hash draft table ${tableName}: project_id column is required`);
  }

  const { data, error } = await client
    .from(tableName)
    .select('*')
    .eq('is_published', false)
    .order('id', { ascending: true });

  if (error) {
    throw new Error(`Failed to hash draft table ${tableName}: ${error.message}`);
  }

  return normalizeDraftRows(data || []);
}

async function selectDraftFingerprintRows(client: any, tableName: string, projectId: string): Promise<unknown[]> {
  const hasProjectScope = await tableHasProjectScopeColumn(client, tableName);
  if (hasProjectScope) {
    const { data, error } = await client
      .from(tableName)
      .select('*')
      .eq('is_published', false)
      .eq('project_id', projectId)
      .order('id', { ascending: true });

    if (error) {
      throw new Error(`Failed to fingerprint draft table ${tableName}: ${error.message}`);
    }
    return normalizeDraftRows(data || []);
  }

  if (isProjectScopeRequired()) {
    throw new Error(`Failed to fingerprint draft table ${tableName}: project_id column is required`);
  }

  const { data, error } = await client
    .from(tableName)
    .select('*')
    .eq('is_published', false)
    .order('id', { ascending: true });

  if (error) {
    throw new Error(`Failed to fingerprint draft table ${tableName}: ${error.message}`);
  }

  return normalizeDraftRows(data || []);
}

async function selectSettingsRows(client: any, projectId: string): Promise<unknown[]> {
  const hasProjectScope = await tableHasProjectScopeColumn(client, 'settings');
  if (hasProjectScope) {
    const { data, error } = await client
      .from('settings')
      .select('key, value, updated_at')
      .neq('key', 'published_at')
      .eq('project_id', projectId)
      .order('key', { ascending: true });

    if (error) {
      throw new Error(`Failed to hash settings: ${error.message}`);
    }
    return data || [];
  }

  if (isProjectScopeRequired()) {
    throw new Error('Failed to hash settings: project_id column is required');
  }

  const { data, error } = await client
    .from('settings')
    .select('key, value, updated_at')
    .neq('key', 'published_at')
    .order('key', { ascending: true });

  if (error) {
    throw new Error(`Failed to hash settings: ${error.message}`);
  }

  return data || [];
}

async function selectColorVariableRows(client: any, projectId: string): Promise<unknown[]> {
  const hasProjectScope = await tableHasProjectScopeColumn(client, 'color_variables');
  if (hasProjectScope) {
    const { data, error } = await client
      .from('color_variables')
      .select('id, name, value, sort_order, updated_at')
      .eq('project_id', projectId)
      .order('sort_order', { ascending: true })
      .order('id', { ascending: true });

    if (error) {
      throw new Error(`Failed to hash color variables: ${error.message}`);
    }
    return data || [];
  }

  if (isProjectScopeRequired()) {
    throw new Error('Failed to hash color variables: project_id column is required');
  }

  const { data, error } = await client
    .from('color_variables')
    .select('id, name, value, sort_order, updated_at')
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true });

  if (error) {
    throw new Error(`Failed to hash color variables: ${error.message}`);
  }

  return data || [];
}

function normalizeDraftRows(rows: Array<Record<string, unknown>>): unknown[] {
  return rows.map((row: Record<string, unknown>) => {
    const { created_at, updated_at, ...stableRow } = row;
    return stableRow;
  });
}

async function draftChangedAfter(client: any, projectId: string, issuedAt: number): Promise<boolean> {
  const issuedAtIso = new Date(issuedAt).toISOString();
  const draftTables = [
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

  const checks = await Promise.all([
    ...draftTables.map(async (tableName) => {
      const hasProjectScope = await tableHasProjectScopeColumn(client, tableName);
      if (hasProjectScope) {
        const { data, error } = await client
          .from(tableName)
          .select('id')
          .eq('is_published', false)
          .eq('project_id', projectId)
          .gt('updated_at', issuedAtIso)
          .limit(1);

        if (error) return true;
        return Array.isArray(data) && data.length > 0;
      }

      if (isProjectScopeRequired()) return true;
      return false;
    }),
    (async () => {
      const hasProjectScope = await tableHasProjectScopeColumn(client, 'color_variables');
      if (hasProjectScope) {
        const { data, error } = await client
          .from('color_variables')
          .select('id')
          .eq('project_id', projectId)
          .gt('updated_at', issuedAtIso)
          .limit(1);

        if (error) return true;
        return Array.isArray(data) && data.length > 0;
      }

      if (isProjectScopeRequired()) return true;
      return false;
    })(),
    (async () => {
      const hasProjectScope = await tableHasProjectScopeColumn(client, 'settings');
      if (hasProjectScope) {
        const { data, error } = await client
          .from('settings')
          .select('key')
          .neq('key', 'published_at')
          .eq('project_id', projectId)
          .gt('updated_at', issuedAtIso)
          .limit(1);

        if (error) return true;
        return Array.isArray(data) && data.length > 0;
      }

      if (isProjectScopeRequired()) return true;
      return false;
    })(),
  ]);

  return checks.some(Boolean);
}

async function hasValidPreviewApproval(client: any, projectId: string, draftHash: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - PREVIEW_MAX_AGE_HOURS * 60 * 60 * 1000).toISOString();
  const { data, error } = await client
    .from('novum_preview_runs')
    .select('id, actor_user_id, metadata')
    .eq('project_id', projectId)
    .eq('draft_hash', draftHash)
    .eq('status', 'created')
    .not('actor_user_id', 'is', null)
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error || !Array.isArray(data)) return false;

  for (const approval of data as Array<{ actor_user_id?: string; metadata?: Record<string, unknown> }>) {
    if (approval.metadata?.explicitApproval !== true) continue;
    if (typeof approval.metadata.renderedPreviewRunId !== 'string') continue;
    if (!approval.actor_user_id) continue;

    const { data: renderedPreview, error: renderedPreviewError } = await client
      .from('novum_preview_runs')
      .select('id, metadata')
      .eq('id', approval.metadata.renderedPreviewRunId)
      .eq('project_id', projectId)
      .eq('actor_user_id', approval.actor_user_id)
      .eq('draft_hash', draftHash)
      .eq('source', 'ycode_preview')
      .eq('status', 'created')
      .maybeSingle();

    if (!renderedPreviewError && hasPreviewRenderProof(renderedPreview?.metadata)) {
      return true;
    }
  }

  return false;
}

function normalizePreviewUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 2048) return null;
  if (/[\r\n]/.test(trimmed)) return null;

  let url: URL;
  try {
    url = trimmed.startsWith('/')
      ? new URL(trimmed, 'http://studio.local')
      : new URL(trimmed);
  } catch {
    return null;
  }

  if (url.pathname !== '/ycode/preview' && !url.pathname.startsWith('/ycode/preview/')) return null;
  const previewUrl = `${url.pathname}${url.search}`;
  return previewUrl;
}

function parsePreviewNonce(value: string): {
  raw: string;
  issuedAt: number;
  siteKey: string;
  actorUserId: string;
  projectId: string;
  draftHash: string;
  previewUrl: string;
} | null {
  const lastDot = value.lastIndexOf('.');
  if (lastDot < 1) return null;
  const unsignedValue = value.slice(0, lastDot);
  const signature = value.slice(lastDot + 1);
  const expectedSignature = signPreviewNoncePayload(unsignedValue);
  if (!expectedSignature || !timingSafeEqualHex(signature, expectedSignature)) return null;

  const firstDot = unsignedValue.indexOf('.');
  const secondDot = firstDot >= 0 ? unsignedValue.indexOf('.', firstDot + 1) : -1;
  const thirdDot = secondDot >= 0 ? unsignedValue.indexOf('.', secondDot + 1) : -1;
  const fourthDot = thirdDot >= 0 ? unsignedValue.indexOf('.', thirdDot + 1) : -1;
  const fifthDot = fourthDot >= 0 ? unsignedValue.indexOf('.', fourthDot + 1) : -1;
  const sixthDot = fifthDot >= 0 ? unsignedValue.indexOf('.', fifthDot + 1) : -1;
  if (firstDot < 1 || secondDot < firstDot + 2 || thirdDot < secondDot + 2 || fourthDot < thirdDot + 2 || fifthDot < fourthDot + 2 || sixthDot < fifthDot + 2) return null;
  const issuedAtRaw = unsignedValue.slice(0, firstDot);
  const nonceValue = unsignedValue.slice(firstDot + 1, secondDot);
  const encodedSiteKey = unsignedValue.slice(secondDot + 1, thirdDot);
  const encodedActorUserId = unsignedValue.slice(thirdDot + 1, fourthDot);
  const encodedProjectId = unsignedValue.slice(fourthDot + 1, fifthDot);
  const encodedDraftHash = unsignedValue.slice(fifthDot + 1, sixthDot);
  const encodedPreviewUrl = unsignedValue.slice(sixthDot + 1);
  const issuedAt = Number(issuedAtRaw);
  const nonceAgeMs = Number.isFinite(issuedAt) ? Date.now() - issuedAt : Number.POSITIVE_INFINITY;
  if (!nonceValue || nonceAgeMs < 0 || nonceAgeMs > PREVIEW_NONCE_MAX_AGE_MINUTES * 60 * 1000) return null;

  let previewUrl: string | null = null;
  let siteKey = '';
  let actorUserId = '';
  let projectId = '';
  let draftHash = '';
  try {
    siteKey = decodeURIComponent(encodedSiteKey || '');
    actorUserId = decodeURIComponent(encodedActorUserId || '');
    projectId = decodeURIComponent(encodedProjectId || '');
    draftHash = decodeURIComponent(encodedDraftHash || '');
    previewUrl = normalizePreviewUrl(decodeURIComponent(encodedPreviewUrl || ''));
  } catch {
    previewUrl = null;
  }

  if (!previewUrl || !siteKey || !actorUserId || !projectId || !/^[a-f0-9]{64}$/i.test(draftHash)) return null;
  return { raw: value, issuedAt, siteKey, actorUserId, projectId, draftHash, previewUrl };
}

function getPreviewNonceSecret(): string | null {
  return process.env.NOVUM_PREVIEW_NONCE_SECRET
    || process.env.SUPABASE_SECRET_KEY
    || process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.SUPABASE_DB_PASSWORD
    || null;
}

function signPreviewNoncePayload(payload: string): string | null {
  const secret = getPreviewNonceSecret();
  if (!secret) return null;
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function hashPreviewNonce(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function timingSafeEqualHex(actual: string, expected: string): boolean {
  if (!/^[a-f0-9]+$/i.test(actual) || !/^[a-f0-9]+$/i.test(expected)) return false;
  const actualBuffer = Buffer.from(actual, 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

async function getRecentRenderedPreview(
  client: any,
  projectId: string,
  actorUserId: string,
  draftHash: string,
  previewUrl: string
): Promise<{ id: string; preview_url: string } | null> {
  const cutoff = new Date(Date.now() - PREVIEW_MAX_AGE_HOURS * 60 * 60 * 1000).toISOString();
  const { data, error } = await client
    .from('novum_preview_runs')
    .select('id, preview_url, metadata')
    .eq('project_id', projectId)
    .eq('actor_user_id', actorUserId)
    .eq('draft_hash', draftHash)
    .eq('preview_url', previewUrl)
    .eq('source', 'ycode_preview')
    .eq('status', 'created')
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(10);

  if (error || !Array.isArray(data) || data.length === 0) return null;
  return data.find((row: { id: string; preview_url: string; metadata?: Record<string, unknown> }) => (
    hasPreviewRenderProof(row.metadata)
  )) || null;
}

function hasPreviewRenderProof(metadata: Record<string, unknown> | null | undefined): boolean {
  if (!metadata) return false;

  if (metadata.serverSideRenderProof === true) {
    const artifact = metadata.renderArtifact;
    if (!artifact || typeof artifact !== 'object') return false;
    const typedArtifact = artifact as Record<string, unknown>;
    if (typeof typedArtifact.kind !== 'string' || !typedArtifact.kind.trim()) return false;
    if (typeof typedArtifact.reportPath !== 'string' || !typedArtifact.reportPath.trim()) return false;
    if (typeof typedArtifact.generatedAt !== 'string' || !typedArtifact.generatedAt.trim()) return false;
    if (typeof typedArtifact.pairCount !== 'number' || typedArtifact.pairCount <= 0) return false;
    if (!Array.isArray(typedArtifact.failingPairs) || typedArtifact.failingPairs.length !== 0) return false;
    return true;
  }

  // Legacy client-only heartbeat rows prove that an authenticated browser saw
  // a visible draft, but same-origin custom code could forge them. Publish
  // readiness therefore only accepts rows upgraded by the trusted server route
  // with a signed nonce-bound render artifact.
  if (metadata.clientHeartbeat === true || metadata.clientVisibilityProof === true) return false;
  return false;
}

async function collectCustomCodeSnippets(client: any, projectId: string, isPublished: boolean): Promise<CodeSnippet[]> {
  const snippets: CodeSnippet[] = [];

  const settingsQuery = client
    .from('settings')
    .select('key, value')
    .in('key', ['custom_code_head', 'custom_code_body']);
  const { data: settings } = await applyOptionalProjectScope(settingsQuery, client, 'settings', projectId);

  for (const setting of settings || []) {
    if (typeof setting.value === 'string' && setting.value.trim()) {
      snippets.push({ scope: 'global', targetId: setting.key, content: setting.value });
    }
  }

  const pagesQuery = client
    .from('pages')
    .select('id, settings')
    .eq('is_published', isPublished)
    .is('deleted_at', null);
  const { data: pages } = await applyOptionalProjectScope(pagesQuery, client, 'pages', projectId);

  for (const page of pages || []) {
    const head = page.settings?.custom_code?.head;
    const body = page.settings?.custom_code?.body;
    if (typeof head === 'string' && head.trim()) {
      snippets.push({ scope: 'page', targetId: `${page.id}:head`, content: head });
    }
    if (typeof body === 'string' && body.trim()) {
      snippets.push({ scope: 'page', targetId: `${page.id}:body`, content: body });
    }
  }

  const pageLayersQuery = client
    .from('page_layers')
    .select('page_id, layers')
    .eq('is_published', isPublished)
    .is('deleted_at', null);
  const { data: pageLayers } = await applyOptionalProjectScope(pageLayersQuery, client, 'page_layers', projectId);

  for (const row of pageLayers || []) {
    walkLayers(row.layers, (layer) => {
      const code = layer?.settings?.htmlEmbed?.code;
      if (layer?.name === 'htmlEmbed' && typeof code === 'string' && code.trim()) {
        snippets.push({ scope: 'embed', targetId: `${row.page_id}:${layer.id}`, content: code });
      }
    });
  }

  const componentsQuery = client
    .from('components')
    .select('id, layers')
    .eq('is_published', isPublished)
    .is('deleted_at', null);
  const { data: components } = await applyOptionalProjectScope(componentsQuery, client, 'components', projectId);

  for (const component of components || []) {
    walkLayers(component.layers, (layer) => {
      const code = layer?.settings?.htmlEmbed?.code;
      if (layer?.name === 'htmlEmbed' && typeof code === 'string' && code.trim()) {
        snippets.push({ scope: 'embed', targetId: `component:${component.id}:${layer.id}`, content: code });
      }
    });
  }

  return snippets;
}

function walkLayers(layerOrLayers: any, visit: (layer: any) => void) {
  if (Array.isArray(layerOrLayers)) {
    for (const layer of layerOrLayers) walkLayers(layer, visit);
    return;
  }

  if (!layerOrLayers || typeof layerOrLayers !== 'object') return;
  visit(layerOrLayers);
  for (const child of layerOrLayers.children || []) walkLayers(child, visit);
}

function scanForSecrets(content: string): Array<{ kind: string; match: string }> {
  const patterns: Array<[string, RegExp]> = [
    ['private_key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/i],
    ['supabase_service_role', /eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}/],
    ['openai_key', /sk-[a-zA-Z0-9_-]{20,}/],
    ['generic_secret_assignment', /(api[_-]?key|secret|token|password)\s*[:=]\s*['"][^'"]{12,}['"]/i],
  ];

  return patterns.flatMap(([kind, pattern]) => {
    const match = content.match(pattern)?.[0];
    return match ? [{ kind, match: redact(match) }] : [];
  });
}

function stableStringify(value: any): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value !== 'object') return String(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `"${key}":${stableStringify(value[key])}`).join(',')}}`;
}

function redact(value: string): string {
  if (value.length <= 12) return '[redacted]';
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}
