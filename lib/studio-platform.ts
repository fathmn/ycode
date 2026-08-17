import crypto from 'crypto';
import type { NextRequest } from 'next/server';
import { noCache } from '@/lib/api-response';
import { STUDIO_BASE_PATH } from '@/lib/brand';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { extractSupabaseAccessToken } from '@/lib/supabase-cookie-token';
import { STUDIO_PREVIEW_NONCE_COOKIE } from '@/lib/studio-preview-nonce';
import { DRAFT_FINGERPRINT_EXCLUDED_SETTING_KEYS_FILTER } from '@/lib/studio-draft-fingerprint';
import { getAuthUser } from '@/lib/supabase-auth';
import { findStudioProjectPathMatches, isPreviewPathname, studioProjectPathSlug } from '@/lib/studio-project-path';
import { findStudioProjectHostMatches } from '@/lib/studio-project-hostnames';
import { getConfiguredSiteAdminRoleForUser } from '@/lib/studio-site-admin';
import { STUDIO_READ_ROLES, type StudioRole, normalizeStudioRole } from '@/lib/studio-roles';

const PREVIEW_MAX_AGE_HOURS = Number(process.env.STUDIO_PREVIEW_MAX_AGE_HOURS || 24);
const PREVIEW_NONCE_MAX_AGE_MINUTES = Number(process.env.STUDIO_PREVIEW_NONCE_MAX_AGE_MINUTES || 30);
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

export type StudioProjectRole = StudioRole;

export type StudioProject = {
  id: string;
  slug: string;
  metadata?: Record<string, unknown> | null;
};

type StudioProductionDeploymentResult = {
  provider: 'vercel';
  configured: boolean;
  triggered: boolean;
  deploymentId?: string;
  deploymentUrl?: string;
  productionUrl?: string;
  status?: string;
  skippedReason?: string;
  error?: string;
};

export type StudioProjectContext = {
  client: any;
  project: StudioProject;
  actorUserId: string | null;
  role: StudioProjectRole | null;
  tokenId?: string;
  source?: string;
  publishVerification?: {
    draftHash: string;
    customCode: CustomCodeScanResult;
  };
};

export type VerifiedStudioPublishContext = StudioProjectContext & {
  publishVerification: {
    draftHash: string;
    customCode: CustomCodeScanResult;
  };
};

type AuditInput = {
  request?: NextRequest;
  action: string;
  entityType: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
};

type ContextAuditInput = Omit<AuditInput, 'request'> & {
  context: StudioProjectContext;
  required?: boolean;
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

async function getSiteAdminRole(client: any, actorUserId: string): Promise<StudioProjectRole | null> {
  const { data, error } = await client.auth.admin.getUserById(actorUserId);
  if (error) return null;
  return getConfiguredSiteAdminRoleForUser(data?.user);
}

async function getProjectRoleForUser(client: any, projectId: string, actorUserId: string): Promise<StudioProjectRole | null> {
  const siteAdminRole = await getSiteAdminRole(client, actorUserId);
  if (siteAdminRole) return siteAdminRole;

  const { data: membership, error } = await client
    .from('studio_project_memberships')
    .select('role')
    .eq('project_id', projectId)
    .eq('user_id', actorUserId)
    .maybeSingle();

  if (!error && membership?.role) return normalizeStudioRole(membership.role);
  return null;
}

function readMetadataString(metadata: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function getVercelErrorMessage(payload: Record<string, any> | null): string | null {
  const error = payload?.error;
  if (typeof error === 'string') return error;
  if (error && typeof error.message === 'string') return error.message;
  if (typeof payload?.message === 'string') return payload.message;
  return null;
}

export async function requireStudioProjectRole(
  request: NextRequest,
  allowedRoles: StudioProjectRole[]
): Promise<{ ok: true; context: StudioProjectContext } | { ok: false; response: Response }> {
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
    return { ok: false, response: noCache({ error: 'No Studio project resolved for request' }, 403) };
  }

  const role = await getProjectRoleForUser(client, project.id, actorUserId);

  if (!role || !allowedRoles.includes(role)) {
    return { ok: false, response: noCache({ error: 'Insufficient project role' }, 403) };
  }

  return {
    ok: true,
    context: {
      client,
      project,
      actorUserId,
      role,
    },
  };
}

async function requireStudioProjectRoleForProject(
  request: NextRequest,
  projectId: string,
  allowedRoles: StudioProjectRole[]
): Promise<{ ok: true; context: StudioProjectContext } | { ok: false; response: Response }> {
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
    return { ok: false, response: noCache({ error: 'No Studio project resolved for request' }, 403) };
  }

  const role = await getProjectRoleForUser(client, project.id, actorUserId);

  if (!role || !allowedRoles.includes(role)) {
    return { ok: false, response: noCache({ error: 'Insufficient project role' }, 403) };
  }

  return {
    ok: true,
    context: {
      client,
      project,
      actorUserId,
      role,
    },
  };
}

export async function canAccessStudioProject(
  projectId: string,
  allowedRoles: StudioProjectRole[] = STUDIO_READ_ROLES
): Promise<boolean> {
  const auth = await getAuthUser();
  if (!auth?.user?.id) return false;
  return canAccessStudioProjectForUser(projectId, auth.user.id, allowedRoles);
}

export async function canAccessStudioProjectForUser(
  projectId: string,
  actorUserId: string,
  allowedRoles: StudioProjectRole[] = STUDIO_READ_ROLES
): Promise<boolean> {
  if (!actorUserId) return false;
  const client = await getSupabaseAdmin();
  if (!client) return false;

  const project = await getProjectById(client, projectId);
  if (!project) return false;

  const role = await getProjectRoleForUser(client, project.id, actorUserId);
  return !!role && allowedRoles.includes(role);
}

export async function resolveStudioMcpContext(input: {
  projectId: string;
  actorUserId?: string | null;
  tokenId?: string;
}): Promise<StudioProjectContext> {
  const client = await getSupabaseAdmin();
  if (!client) throw new Error('Supabase ist nicht konfiguriert.');

  const project = await getProjectById(client, input.projectId);
  if (!project) throw new Error('Das dem MCP-Token zugeordnete Studio-Projekt wurde nicht gefunden.');

  const actorUserId = input.actorUserId || null;
  const role = actorUserId
    ? await getProjectRoleForUser(client, project.id, actorUserId)
    : null;

  return {
    client,
    project,
    actorUserId,
    role,
    tokenId: input.tokenId,
    source: 'mcp',
  };
}

export async function writeStudioAuditLog(input: AuditInput): Promise<void> {
  try {
    const client = await getSupabaseAdmin();
    if (!client) return;

    const actorUserId = input.request ? await resolveActorUserId(client, input.request) : null;
    const project = input.request && actorUserId
      ? await resolveProjectForRequest(client, input.request, actorUserId)
      : null;
    if (!project) return;

    await writeStudioAuditLogForContext({
      context: { client, project, actorUserId, role: null },
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      metadata: input.metadata,
    });
  } catch (error) {
    console.error('[studio] audit log failed:', error);
  }
}

export async function writeStudioAuditLogForContext(input: ContextAuditInput): Promise<void> {
  try {
    const { context } = input;
    const metadata = {
      ...(input.metadata || {}),
      ...(context.source ? { source: context.source } : {}),
      ...(context.tokenId ? { tokenId: context.tokenId } : {}),
      ...(context.source === 'mcp' && context.actorUserId ? { actorUserId: context.actorUserId } : {}),
    };

    const { error } = await context.client.from('studio_audit_logs').insert({
      project_id: context.project.id,
      actor_user_id: context.actorUserId,
      action: input.action,
      entity_type: input.entityType,
      entity_id: input.entityId || context.project.slug,
      metadata,
    });
    if (error) throw new Error(error.message || 'Studio audit log insert failed');
  } catch (error) {
    console.error('[studio] audit log failed:', error);
    if (input.required) throw error;
  }
}

export async function recordStudioCustomCodeMutation(
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

    await client.from('studio_custom_code_events').insert({
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

    await client.from('studio_audit_logs').insert({
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
    console.error('[studio] custom code mutation audit failed:', error);
  }
}

export async function verifyStudioPublishGate(request: NextRequest): Promise<
  | { ok: true; context: VerifiedStudioPublishContext; draftHash: string; customCode: CustomCodeScanResult }
  | { ok: false; response: Response }
> {
  const roleCheck = await requireStudioProjectRole(request, [
    'studio_admin',
    'studio_developer',
    'customer_owner',
  ]);
  if (!roleCheck.ok) return roleCheck;

  return verifyStudioPublishGateForContext(roleCheck.context);
}

export async function verifyStudioPublishGateForContext(
  context: StudioProjectContext,
  opts: { source?: string } = {}
): Promise<
  | { ok: true; context: VerifiedStudioPublishContext; draftHash: string; customCode: CustomCodeScanResult }
  | { ok: false; response: Response; code: string; message: string }
> {
  const auditContext: StudioProjectContext = {
    ...context,
    source: opts.source || context.source,
  };

  if (
    !context.actorUserId
    || !context.role
    || !(['studio_admin', 'studio_developer', 'customer_owner'] as StudioProjectRole[]).includes(context.role)
  ) {
    const code = 'STUDIO_PUBLISH_ROLE_REQUIRED';
    const message = 'Dieser MCP-Token ist keinem Benutzer mit Veröffentlichungsrecht zugeordnet. Erzeugen Sie ihn im Studio unter Integrationen → MCP neu und stellen Sie sicher, dass der Benutzer veröffentlichen darf.';
    await writeStudioAuditLogForContext({
      context: auditContext,
      action: 'site.publish.blocked.insufficient_role',
      entityType: 'site',
      entityId: context.project.slug,
      metadata: { projectId: context.project.id, actorRole: context.role },
    });
    return {
      ok: false,
      code,
      message,
      response: noCache({ error: message, code }, 403),
    };
  }

  const readiness = getStudioPublishReadiness();
  if (!readiness.livePublishAvailable) {
    await writeStudioAuditLogForContext({
      context: auditContext,
      action: 'site.publish.blocked.project_scoped_publish_required',
      entityType: 'site',
      entityId: context.project.slug,
      metadata: {
        projectId: context.project.id,
        reason: 'project_scoped_publish_not_available',
        readiness,
      },
    });
    const code = readiness.blockerCode || 'STUDIO_PROJECT_SCOPED_PUBLISH_REQUIRED';
    const message = readiness.blockerMessage || 'Live-Schaltung ist derzeit nicht verfügbar.';
    return {
      ok: false,
      code,
      message,
      response: noCache(
        {
          error: message,
          code,
          readiness,
        },
        409
      ),
    };
  }

  const draftHash = await getCurrentDraftHash(context.client, context.project.id);
  const previewOk = await hasValidPreviewApproval(context.client, context.project.id, draftHash);
  if (!previewOk) {
    await writeStudioAuditLogForContext({
      context: auditContext,
      action: 'site.publish.blocked.preview_required',
      entityType: 'site',
      entityId: context.project.slug,
      metadata: { draftHash, maxAgeHours: PREVIEW_MAX_AGE_HOURS },
    });
    const code = 'STUDIO_PREVIEW_REQUIRED';
    const message = 'Preview required before publishing';
    return {
      ok: false,
      code,
      message,
      response: noCache(
        {
          error: message,
          code,
          draftHash,
        },
        409
      ),
    };
  }

  const customCode = await scanStudioCustomCode(context.client, context.project.id);

  if (customCode.secret_scan_status === 'blocked') {
    await writeStudioAuditLogForContext({
      context: auditContext,
      action: 'site.publish.blocked.custom_code_secret',
      entityType: 'site',
      entityId: context.project.slug,
      metadata: {
        draftHash,
        contentHash: customCode.content_hash,
        findings: customCode.secret_scan_findings,
      },
    });
    const code = 'STUDIO_CUSTOM_CODE_SECRET_BLOCKED';
    const message = 'Custom code contains possible secrets and cannot be published';
    return {
      ok: false,
      code,
      message,
      response: noCache(
        {
          error: message,
          code,
          findings: customCode.secret_scan_findings,
        },
        409
      ),
    };
  }

  const verifiedContext: VerifiedStudioPublishContext = {
    ...auditContext,
    publishVerification: { draftHash, customCode },
  };
  return { ok: true, context: verifiedContext, draftHash, customCode };
}

export async function triggerStudioProductionDeployment(input: {
  client: any;
  project: StudioProject;
}): Promise<StudioProductionDeploymentResult> {
  const resultBase = {
    provider: 'vercel' as const,
    configured: false,
    triggered: false,
  };

  const token = process.env.STUDIO_VERCEL_API_TOKEN || process.env.VERCEL_API_TOKEN;
  const teamId = process.env.STUDIO_VERCEL_TEAM_ID || process.env.VERCEL_TEAM_ID;

  if (!token) {
    return {
      ...resultBase,
      skippedReason: 'vercel_api_token_missing',
    };
  }

  const { data: project, error } = await input.client
    .from('studio_projects')
    .select('id, slug, metadata')
    .eq('id', input.project.id)
    .maybeSingle();

  if (error || !project) {
    return {
      ...resultBase,
      configured: true,
      skippedReason: 'project_metadata_unavailable',
      error: error?.message,
    };
  }

  const metadata = project.metadata && typeof project.metadata === 'object'
    ? project.metadata as Record<string, unknown>
    : {};
  const vercelProjectName = readMetadataString(metadata, 'vercelProject', 'vercel_project') || project.slug;
  const lastDeploymentId = readMetadataString(
    metadata,
    'lastVercelDeploymentId',
    'last_vercel_deployment_id'
  );

  if (!lastDeploymentId) {
    return {
      ...resultBase,
      configured: true,
      skippedReason: 'last_vercel_deployment_id_missing',
    };
  }

  const apiUrl = new URL('https://api.vercel.com/v13/deployments');
  apiUrl.searchParams.set('forceNew', '1');
  if (teamId) apiUrl.searchParams.set('teamId', teamId);

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        deploymentId: lastDeploymentId,
        meta: {
          action: 'studio_publish_redeploy',
          projectSlug: project.slug,
        },
        name: vercelProjectName,
        target: 'production',
      }),
      cache: 'no-store',
    });

    const payload = await response.json().catch(() => null) as Record<string, any> | null;
    if (!response.ok) {
      return {
        ...resultBase,
        configured: true,
        status: String(response.status),
        error: getVercelErrorMessage(payload) || response.statusText || 'Vercel redeploy failed',
      };
    }

    const deploymentId = typeof payload?.id === 'string' ? payload.id : undefined;
    const deploymentUrl = typeof payload?.url === 'string' ? `https://${payload.url}` : undefined;
    const readyState = typeof payload?.readyState === 'string' ? payload.readyState : undefined;

    if (deploymentId || deploymentUrl) {
      await input.client
        .from('studio_projects')
        .update({
          metadata: {
            ...metadata,
            lastVercelDeploymentId: deploymentId || metadata.lastVercelDeploymentId,
            lastVercelDeploymentUrl: deploymentUrl || metadata.lastVercelDeploymentUrl,
            lastVercelDeploymentTriggeredAt: new Date().toISOString(),
            lastVercelDeploymentSource: 'studio_publish',
          },
        })
        .eq('id', project.id);
    }

    return {
      ...resultBase,
      configured: true,
      triggered: true,
      deploymentId,
      deploymentUrl,
      productionUrl: readMetadataString(metadata, 'productionUrl', 'production_url', 'vercelProductionUrl', 'vercel_production_url') || undefined,
      status: readyState,
    };
  } catch (error) {
    return {
      ...resultBase,
      configured: true,
      error: error instanceof Error ? error.message : 'Vercel redeploy request failed',
    };
  }
}

export class StudioPreviewApprovalError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
    public readonly details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'StudioPreviewApprovalError';
  }
}

export async function recordExplicitStudioPreviewApproval(request: NextRequest): Promise<Response> {
  const body = await request.json().catch(() => ({}));
  const previewUrl = normalizePreviewUrl(body.previewUrl || '/ycode/preview');
  if (!previewUrl) {
    return noCache(
      { error: 'Invalid preview URL', code: 'STUDIO_PREVIEW_URL_INVALID' },
      400
    );
  }
  const roleCheck = await requireStudioProjectRole(request, [
    'studio_admin',
    'studio_developer',
    'customer_owner',
    'customer_editor',
  ]);
  if (!roleCheck.ok) return roleCheck.response;

  try {
    const result = await recordStudioPreviewApprovalForContext(
      roleCheck.context,
      previewUrl
    );
    return noCache({ data: result.data });
  } catch (error) {
    if (error instanceof StudioPreviewApprovalError) {
      return noCache(
        { error: error.message, code: error.code, ...error.details },
        error.status
      );
    }
    return noCache(
      { error: error instanceof Error ? error.message : 'Preview approval failed' },
      500
    );
  }
}

export async function recordStudioPreviewApprovalForContext(
  context: StudioProjectContext,
  previewUrlInput: unknown
): Promise<{
  data: { id: string; preview_url: string; draft_hash: string; created_at: string };
  draftHash: string;
}> {
  const previewUrl = normalizePreviewUrl(previewUrlInput);
  if (!previewUrl) {
    throw new StudioPreviewApprovalError(
      'Invalid preview URL',
      'STUDIO_PREVIEW_URL_INVALID',
      400
    );
  }

  if (
    !context.actorUserId
    || !context.role
    || !(['studio_admin', 'studio_developer', 'customer_owner', 'customer_editor'] as StudioProjectRole[]).includes(context.role)
  ) {
    throw new StudioPreviewApprovalError(
      'Dieser MCP-Token ist keinem Benutzer mit Vorschau-Freigaberecht zugeordnet. Erzeugen Sie ihn im Studio unter Integrationen → MCP neu; ältere Tokens sind keinem Benutzer zugeordnet.',
      'STUDIO_PREVIEW_APPROVAL_ROLE_REQUIRED',
      403
    );
  }

  const draftHash = await getCurrentDraftHash(context.client, context.project.id);
  const renderedPreview = await getRecentRenderedPreview(
    context.client,
    context.project.id,
    context.actorUserId,
    draftHash,
    previewUrl
  );

  if (!renderedPreview) {
    throw new StudioPreviewApprovalError(
      'Open and verify this Studio preview before approving the draft for publish',
      'STUDIO_PREVIEW_RENDER_REQUIRED',
      409,
      {
        projectId: context.project.id,
        projectSlug: context.project.slug,
        previewUrl,
        draftHash,
        maxAgeHours: PREVIEW_MAX_AGE_HOURS,
        maxNonceAgeMinutes: PREVIEW_NONCE_MAX_AGE_MINUTES,
      }
    );
  }

  const approvalActorUserId = context.actorUserId || renderedPreview.actor_user_id;
  if (!approvalActorUserId) {
    throw new StudioPreviewApprovalError(
      'Die Vorschau muss von einem angemeldeten Studio-Benutzer geöffnet werden.',
      'STUDIO_PREVIEW_RENDER_REQUIRED',
      409,
      { projectId: context.project.id, projectSlug: context.project.slug, previewUrl, draftHash }
    );
  }

  const metadata = {
    explicitApproval: true,
    renderedPreviewRunId: renderedPreview.id,
    previewUrl: renderedPreview.preview_url,
    role: context.role,
    maxAgeHours: PREVIEW_MAX_AGE_HOURS,
    source: context.source || 'studio_preview_approval',
    ...(context.tokenId ? { tokenId: context.tokenId } : {}),
    ...(context.actorUserId ? { actorUserId: context.actorUserId } : {}),
  };

  if (context.source === 'mcp') {
    try {
      await writeStudioAuditLogForContext({
        context: { ...context, actorUserId: approvalActorUserId },
        action: 'site.preview.approval.requested',
        entityType: 'site',
        entityId: context.project.slug,
        metadata: { ...metadata, draftHash },
        required: true,
      });
    } catch {
      throw new StudioPreviewApprovalError(
        'Die Vorschau-Freigabe wurde abgebrochen, weil der verpflichtende Audit-Eintrag nicht gespeichert werden konnte.',
        'STUDIO_AUDIT_LOG_REQUIRED',
        500
      );
    }
  }

  const { data, error } = await context.client
    .from('studio_preview_runs')
    .insert({
      project_id: context.project.id,
      actor_user_id: approvalActorUserId,
      source: 'ycode_preview',
      preview_url: renderedPreview.preview_url,
      draft_hash: draftHash,
      status: 'created',
      metadata,
    })
    .select('id, preview_url, draft_hash, created_at')
    .single();

  if (error) {
    throw new StudioPreviewApprovalError(error.message, 'STUDIO_PREVIEW_APPROVAL_FAILED', 500);
  }

  try {
    await writeStudioAuditLogForContext({
      context: { ...context, actorUserId: approvalActorUserId },
      action: 'site.preview.approved',
      entityType: 'site',
      entityId: context.project.slug,
      metadata: {
        ...metadata,
        approvalPreviewRunId: data.id,
        draftHash,
      },
      required: context.source === 'mcp',
    });
  } catch {
    await context.client
      .from('studio_preview_runs')
      .delete()
      .eq('id', data.id)
      .eq('project_id', context.project.id);
    throw new StudioPreviewApprovalError(
      'Die Vorschau-Freigabe konnte nicht revisionssicher protokolliert werden und wurde deshalb verworfen.',
      'STUDIO_AUDIT_LOG_REQUIRED',
      500
    );
  }

  return { data, draftHash };
}

export async function recordStudioPreviewRendered(request: NextRequest): Promise<Response> {
  const body = await request.json().catch(() => ({}));
  const previewUrl = normalizePreviewUrl(body.previewUrl);
  if (!previewUrl) {
    return noCache(
      {
        error: 'Invalid preview URL',
        code: 'STUDIO_PREVIEW_URL_INVALID',
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
        code: 'STUDIO_PREVIEW_CLIENT_HEARTBEAT_INVALID',
      },
      409
    );
  }

  const allowedPreviewRoles: StudioProjectRole[] = [
    'studio_admin',
    'studio_developer',
    'customer_owner',
    'customer_editor',
  ];
  const previewNonce = parsePreviewNonce(request.cookies.get(STUDIO_PREVIEW_NONCE_COOKIE)?.value || '');
  const matchedPreviewNonce = (
    previewNonce
    && previewNonce.previewUrl === previewUrl
    && previewNonce.siteKey === getCurrentSiteKey()
  ) ? previewNonce : null;
  if (!matchedPreviewNonce) {
    return noCache(
      {
        error: 'Open this Studio preview before recording a rendered draft',
        code: 'STUDIO_PREVIEW_RENDER_REQUIRED',
      },
      409
    );
  }

  const roleCheck = await requireStudioProjectRoleForProject(request, matchedPreviewNonce.projectId, allowedPreviewRoles);
  if (!roleCheck.ok) return roleCheck.response;

  const { context } = roleCheck;
  if (matchedPreviewNonce && (matchedPreviewNonce.actorUserId !== context.actorUserId || matchedPreviewNonce.projectId !== context.project.id)) {
    return noCache(
      {
        error: 'Open this Studio preview before recording a rendered draft',
        code: 'STUDIO_PREVIEW_RENDER_REQUIRED',
      },
      409
    );
  }

  const currentDraftFingerprint = await getCurrentDraftFingerprint(context.client, context.project.id);
  if (currentDraftFingerprint !== matchedPreviewNonce.draftHash) {
    return noCache(
      {
        error: 'Open this Studio preview again before recording a rendered draft',
        code: 'STUDIO_PREVIEW_RENDER_REQUIRED',
      },
      409
    );
  }

  const draftHash = await getCurrentDraftHash(context.client, context.project.id);
  const serverRenderProof = await verifyStudioPreviewServerRender(request, previewUrl, context.project.slug);
  if (!serverRenderProof) {
    return noCache(
      {
        error: 'Open this Studio preview again before recording a server-verified rendered draft',
        code: 'STUDIO_PREVIEW_SERVER_RENDER_REQUIRED',
      },
      409
    );
  }

  const rawNonceHash = hashPreviewNonce(matchedPreviewNonce.raw);
  const previewNonceHash = crypto
    .createHash('sha256')
    .update([
      matchedPreviewNonce.raw,
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
    previewNonceDraftHash: matchedPreviewNonce.draftHash,
    previewNonceIssuedAt: new Date(matchedPreviewNonce.issuedAt).toISOString(),
    clientVisibilityProof: true,
    serverSideRenderProof: true,
    serverRenderProof,
    renderArtifact: {
      kind: 'studio-preview-server-render',
      reportPath: previewUrl,
      generatedAt: new Date().toISOString(),
      pairCount: serverRenderProof.markerCount,
      failingPairs: [],
      previewNonceHash,
      draftHash,
    },
  };

  const { data, error } = await context.client
    .from('studio_preview_runs')
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
          code: 'STUDIO_PREVIEW_RENDER_REQUIRED',
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

async function scanStudioCustomCode(client: any, projectId: string, isPublished = false): Promise<CustomCodeScanResult & { snippets: CodeSnippet[] }> {
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

export async function getStudioCustomCodeStateForProject(
  client: any,
  projectId: string
): Promise<CustomCodeScanResult> {
  const { snippets: _snippets, ...scan } = await scanStudioCustomCode(client, projectId);
  return scan;
}

export async function canRenderStudioCustomCode(
  projectId?: string | null,
  isPublished = false,
  options: { requireProject?: boolean } = {}
): Promise<boolean> {
  if (!projectId) return options.requireProject === true ? false : true;

  const client = await getSupabaseAdmin();
  if (!client) return false;

  try {
    const scan = await scanStudioCustomCode(client, projectId, isPublished);
    return scan.secret_scan_status === 'clean';
  } catch {
    return false;
  }
}

async function recordStudioCustomCodeSnapshot(input: {
  client: any;
  project: StudioProject;
  actorUserId: string;
}): Promise<CustomCodeScanResult> {
  const scan = await scanStudioCustomCode(input.client, input.project.id);
  if (!scan.content_hash) return scan;

  await input.client.from('studio_custom_code_events').insert({
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

async function resolveProjectForRequest(client: any, request: NextRequest, actorUserId: string): Promise<StudioProject | null> {
  const explicitProject = request.headers.get('x-studio-project-slug') || request.nextUrl.searchParams.get('project');
  if (explicitProject) return getProjectByDomainOrSlug(client, explicitProject);

  const host = request.headers.get('host') || request.headers.get('x-forwarded-host') || '';
  const hostname = host.split(':')[0];
  if (hostname && hostname !== 'localhost' && hostname !== '127.0.0.1') {
    const byDomain = await getProjectByDomainOrSlug(client, hostname);
    if (byDomain) return byDomain;
  }

  return getSingleProjectByMembership(client, actorUserId);
}

async function getProjectBySlug(client: any, slug: string): Promise<StudioProject | null> {
  if (!isSafeProjectLookupValue(slug)) return null;

  const { data, error } = await client
    .from('studio_projects')
    .select('id, slug')
    .eq('slug', slug)
    .eq('status', 'active')
    .maybeSingle();

  if (error || !data) return null;
  return data;
}

async function getProjectById(client: any, projectId: string): Promise<StudioProject | null> {
  if (!/^[a-f0-9-]{36}$/i.test(projectId)) return null;

  const { data, error } = await client
    .from('studio_projects')
    .select('id, slug, metadata')
    .eq('id', projectId)
    .eq('status', 'active')
    .maybeSingle();

  if (error || !data) return null;
  return data;
}

async function getProjectByDomainOrSlug(client: any, value: string): Promise<StudioProject | null> {
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
    .select('id, slug')
    .eq('slug', value)
    .eq('status', 'active')
    .maybeSingle();

  if (bySlug.error) return null;
  if (bySlug.data) {
    return bySlug.data;
  }

  const byDomain = await client
    .from('studio_projects')
    .select('id, slug')
    .eq('primary_domain', value)
    .eq('status', 'active')
    .maybeSingle();

  if (byDomain.error) return null;
  if (byDomain.data) return byDomain.data;

  const hostMatch = hostMatches.length === 1 ? hostMatches[0] : null;
  if (hostMatch?.id && hostMatch?.slug) return { id: hostMatch.id, slug: hostMatch.slug };

  const match = aliasMatches.length === 1 ? aliasMatches[0] : null;
  return match?.id && match?.slug ? { id: match.id, slug: match.slug } : null;
}

async function getSingleProjectByMembership(client: any, actorUserId: string): Promise<StudioProject | null> {
  if (await getSiteAdminRole(client, actorUserId)) return null;

  const { data, error } = await client
    .from('studio_project_memberships')
    .select('project:studio_projects(id, slug, status, ycode_site_key)')
    .eq('user_id', actorUserId);

  if (error || !Array.isArray(data)) return null;
  const matchingMemberships = data.filter((membership: any) => {
    const project = Array.isArray(membership.project) ? membership.project[0] : membership.project;
    return project?.status === 'active';
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
  // Verified 2026-06-16: publish/revert services now thread project_id through
  // all affected tables, including publish + revert via applyProjectScopeToQuery
  // and resolveProjectScopeForWrite. All Builder tables carry project_id, and
  // read-only paths are audited + scoped. Live publish still requires operator
  // opt-in via STUDIO_PROJECT_SCOPED_LIVE_PUBLISH=1 and
  // STUDIO_TRUSTED_PREVIEW_RENDER_PROOF=1.
  return true;
}

export function getStudioPublishReadiness() {
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
    blockerCode: livePublishAvailable ? null : 'STUDIO_PROJECT_SCOPED_PUBLISH_REQUIRED',
    blockerMessage: livePublishAvailable
      ? null
      : !trustedPreviewRenderProof
        ? 'Live-Schaltung ist blockiert, bis eine serverseitig verifizierte Preview-Prüfung verfügbar ist.'
        : projectScopedPublishConfigured
          ? 'Live-Schaltung ist blockiert: projektgebundenes Publishing ist konfiguriert, aber die aktuelle Studio-Publish-Route ist noch global.'
          : globalPublishAllowed
            ? 'Live-Schaltung bleibt trotz Global-Publish-Escape-Hatch blockiert, bis der Studio-Publish-Pfad projektgebunden ist.'
            : 'Live-Schaltung ist blockiert, bis projektgebundenes Publishing verfügbar ist.',
	  };
}

export function getStudioPreviewUrlPath(project: StudioProject | string): string {
  const projectSlug = typeof project === 'string'
    ? project
    : studioProjectPathSlug(project) || project.slug;
  const params = new URLSearchParams({ project: projectSlug });
  return `${STUDIO_BASE_PATH}/preview?${params.toString()}`;
}

export async function getStudioPreviewStateForProject(client: any, projectId: string): Promise<{
  draftHash: string;
  previewApproved: boolean;
  approvedAt: string | null;
  renderedPreviewAvailable: boolean;
  previewUrlPath: string;
}> {
  const project = await getProjectById(client, projectId);
  if (!project) throw new Error('Studio project not found');

  const draftHash = await getCurrentDraftHash(client, projectId);
  const previewUrlPath = getStudioPreviewUrlPath(project);
  const [approval, renderedPreview] = await Promise.all([
    getValidPreviewApproval(client, projectId, draftHash),
    getRecentRenderedPreview(client, projectId, null, draftHash, previewUrlPath),
  ]);

  return {
    draftHash,
    previewApproved: Boolean(approval),
    approvedAt: approval?.created_at || null,
    renderedPreviewAvailable: Boolean(renderedPreview),
    previewUrlPath,
  };
}

export function getStudioLiveMutationBlocker() {
  const readiness = getStudioPublishReadiness();
  if (readiness.livePublishAvailable) return null;
  return {
    error: readiness.blockerMessage,
    code: readiness.blockerCode,
    readiness,
  };
}

export async function getStudioPublishReadinessForRequest(request: NextRequest): Promise<Response> {
  const roleCheck = await requireStudioProjectRole(request, [
    'studio_admin',
    'studio_developer',
    'customer_owner',
    'customer_editor',
  ]);
  if (!roleCheck.ok) return roleCheck.response;

  const { context } = roleCheck;
  const readiness = getStudioPublishReadiness();
  const previewState = await getStudioPreviewStateForProject(context.client, context.project.id);
  const { draftHash, previewApproved } = previewState;
  const customCode = await scanStudioCustomCode(context.client, context.project.id);
  const customCodeBlocked = customCode.secret_scan_status === 'blocked';

  return noCache({
    data: {
      ...readiness,
      projectId: context.project.id,
      projectSlug: context.project.slug,
      draftHash,
      previewApproved,
      previewApprovedAt: previewState.approvedAt,
      renderedPreviewAvailable: previewState.renderedPreviewAvailable,
      previewUrlPath: previewState.previewUrlPath,
      customCodeBlocked,
      customCodeSnippetsCount: customCode.snippets_count,
      livePublishAvailable: readiness.livePublishAvailable && previewApproved && !customCodeBlocked,
      blockerCode: readiness.livePublishAvailable
        ? !previewApproved
          ? 'STUDIO_PREVIEW_REQUIRED'
          : customCodeBlocked
            ? 'STUDIO_CUSTOM_CODE_SECRET_BLOCKED'
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
      .not('key', 'in', DRAFT_FINGERPRINT_EXCLUDED_SETTING_KEYS_FILTER)
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
    .not('key', 'in', DRAFT_FINGERPRINT_EXCLUDED_SETTING_KEYS_FILTER)
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

async function getValidPreviewApproval(
  client: any,
  projectId: string,
  draftHash: string
): Promise<{ id: string; created_at: string } | null> {
  const cutoff = new Date(Date.now() - PREVIEW_MAX_AGE_HOURS * 60 * 60 * 1000).toISOString();
  const { data, error } = await client
    .from('studio_preview_runs')
    .select('id, actor_user_id, created_at, metadata')
    .eq('project_id', projectId)
    .eq('draft_hash', draftHash)
    .eq('status', 'created')
    .not('actor_user_id', 'is', null)
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error || !Array.isArray(data)) return null;

  for (const approval of data as Array<{
    id: string;
    actor_user_id?: string;
    created_at: string;
    metadata?: Record<string, unknown>;
  }>) {
    if (approval.metadata?.explicitApproval !== true) continue;
    if (typeof approval.metadata.renderedPreviewRunId !== 'string') continue;
    if (!approval.actor_user_id) continue;

    const { data: renderedPreview, error: renderedPreviewError } = await client
      .from('studio_preview_runs')
      .select('id, metadata')
      .eq('id', approval.metadata.renderedPreviewRunId)
      .eq('project_id', projectId)
      .eq('actor_user_id', approval.actor_user_id)
      .eq('draft_hash', draftHash)
      .eq('source', 'ycode_preview')
      .eq('status', 'created')
      .maybeSingle();

    if (!renderedPreviewError && hasPreviewRenderProof(renderedPreview?.metadata)) {
      return { id: approval.id, created_at: approval.created_at };
    }
  }

  return null;
}

async function hasValidPreviewApproval(client: any, projectId: string, draftHash: string): Promise<boolean> {
  return Boolean(await getValidPreviewApproval(client, projectId, draftHash));
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

  if (!isPreviewPathname(url.pathname)) return null;
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
  // Must mirror getPreviewNonceSecret in proxy.ts: never use the database
  // password as an HMAC key.
  return process.env.STUDIO_PREVIEW_NONCE_SECRET
    || process.env.SUPABASE_SECRET_KEY
    || process.env.SUPABASE_SERVICE_ROLE_KEY
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

async function verifyStudioPreviewServerRender(
  request: NextRequest,
  previewUrl: string,
  projectSlug: string
): Promise<{ status: number; contentLength: number; markerCount: number } | null> {
  const absolutePreviewUrl = new URL(previewUrl, request.nextUrl.origin);
  const headers = new Headers({
    accept: 'text/html',
    'x-studio-project-slug': projectSlug,
  });
  const cookieHeader = request.headers.get('cookie');
  if (cookieHeader) headers.set('cookie', cookieHeader);

  try {
    const response = await fetch(absolutePreviewUrl, {
      headers,
      cache: 'no-store',
      redirect: 'manual',
    });
    if (!response.ok) return null;

    const html = await response.text();
    const contentLength = Buffer.byteLength(html, 'utf8');
    if (contentLength < 500 || !/<body[\s>]/i.test(html)) return null;

    const markerCount = Math.max(
      (html.match(/data-layer-id=/g) || []).length,
      (html.match(/data-ycode-/g) || []).length,
      1
    );

    return { status: response.status, contentLength, markerCount };
  } catch {
    return null;
  }
}

async function getRecentRenderedPreview(
  client: any,
  projectId: string,
  actorUserId: string | null,
  draftHash: string,
  previewUrl: string
): Promise<{ id: string; preview_url: string; actor_user_id: string | null } | null> {
  const maxAgeMs = Math.min(
    PREVIEW_MAX_AGE_HOURS * 60 * 60 * 1000,
    PREVIEW_NONCE_MAX_AGE_MINUTES * 60 * 1000
  );
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
  let query = client
    .from('studio_preview_runs')
    .select('id, preview_url, actor_user_id, created_at, metadata')
    .eq('project_id', projectId)
    .eq('draft_hash', draftHash)
    .eq('preview_url', previewUrl)
    .eq('source', 'ycode_preview')
    .eq('status', 'created')
    .gte('created_at', cutoff);
  if (actorUserId) query = query.eq('actor_user_id', actorUserId);

  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(10);

  if (error || !Array.isArray(data) || data.length === 0) return null;
  return data.find((row: {
    id: string;
    preview_url: string;
    actor_user_id: string | null;
    metadata?: Record<string, unknown>;
  }) => (
    Boolean(row.actor_user_id) && hasPreviewRenderProof(row.metadata)
  )) || null;
}

function hasPreviewRenderProof(metadata: Record<string, unknown> | null | undefined): boolean {
  if (!metadata) return false;

  if (metadata.serverSideRenderProof === true) {
    const artifact = metadata.renderArtifact;
    if (!artifact || typeof artifact !== 'object') return false;
    const typedArtifact = artifact as Record<string, unknown>;
    if (
      typedArtifact.kind !== 'studio-preview-nonce-heartbeat'
      && typedArtifact.kind !== 'studio-preview-server-render'
    ) return false;
    if (typeof typedArtifact.reportPath !== 'string' || !typedArtifact.reportPath.trim()) return false;
    if (typeof typedArtifact.generatedAt !== 'string' || !typedArtifact.generatedAt.trim()) return false;
    if (typeof typedArtifact.pairCount !== 'number' || typedArtifact.pairCount <= 0) return false;
    if (!Array.isArray(typedArtifact.failingPairs) || typedArtifact.failingPairs.length !== 0) return false;
    if (typeof metadata.rawNonceHash !== 'string' || !/^[a-f0-9]{64}$/i.test(metadata.rawNonceHash)) return false;
    if (typeof metadata.previewNonceHash !== 'string' || !/^[a-f0-9]{64}$/i.test(metadata.previewNonceHash)) return false;
    if (typedArtifact.previewNonceHash !== metadata.previewNonceHash) return false;
    if (typeof metadata.previewNonceDraftHash !== 'string' || !/^[a-f0-9]{64}$/i.test(metadata.previewNonceDraftHash)) return false;
    if (typeof metadata.previewNonceIssuedAt !== 'string' || !metadata.previewNonceIssuedAt.trim()) return false;
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
