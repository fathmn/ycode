import crypto from 'crypto';
import type { NextRequest } from 'next/server';
import { noCache } from '@/lib/api-response';
import { getSupabaseAdmin } from '@/lib/supabase-server';

const PREVIEW_MAX_AGE_HOURS = Number(process.env.NOVUM_PREVIEW_MAX_AGE_HOURS || 24);

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
    'customer_editor',
  ]);
  if (!roleCheck.ok) return roleCheck;

  const { context } = roleCheck;
  const draftHash = await getCurrentDraftHash(context.client);
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

  const customCode = await recordNovumCustomCodeSnapshot({
    client: context.client,
    project: context.project,
    actorUserId: context.actorUserId,
  });

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
  const roleCheck = await requireNovumProjectRole(request, [
    'novum_admin',
    'novum_developer',
    'customer_owner',
    'customer_editor',
  ]);
  if (!roleCheck.ok) return roleCheck.response;

  const { context } = roleCheck;
  const body = await request.json().catch(() => ({}));
  const previewUrl = typeof body.previewUrl === 'string' && body.previewUrl.startsWith('/ycode/preview')
    ? body.previewUrl
    : '/ycode/preview';
  const draftHash = await getCurrentDraftHash(context.client);

  const { data, error } = await context.client
    .from('novum_preview_runs')
    .insert({
      project_id: context.project.id,
      actor_user_id: context.actorUserId,
      source: 'ycode_preview',
      preview_url: previewUrl,
      draft_hash: draftHash,
      status: 'created',
      metadata: {
        explicitApproval: true,
        role: context.role,
      },
    })
    .select('id, preview_url, draft_hash, created_at')
    .single();

  if (error) {
    return noCache({ error: error.message }, 500);
  }

  await writeNovumAuditLog({
    request,
    action: 'site.preview.approved',
    entityType: 'site',
    entityId: context.project.slug,
    metadata: { previewRunId: data.id, previewUrl, draftHash },
  });

  return noCache({ data });
}

type CustomCodeScanResult = {
  content_hash: string | null;
  secret_scan_status: 'clean' | 'blocked';
  secret_scan_findings: Array<{ kind: string; match: string }>;
  snippets_count: number;
};

async function recordNovumCustomCodeSnapshot(input: {
  client: any;
  project: NovumProject;
  actorUserId: string;
}): Promise<CustomCodeScanResult> {
  const snippets = await collectCustomCodeSnippets(input.client);
  const combined = snippets.map((item) => `${item.scope}:${item.targetId || ''}:${item.content}`).join('\n---\n');

  if (!combined.trim()) {
    return {
      content_hash: null,
      secret_scan_status: 'clean',
      secret_scan_findings: [],
      snippets_count: 0,
    };
  }

  const findings = scanForSecrets(combined);
  const status = findings.length > 0 ? 'blocked' : 'clean';
  const contentHash = crypto.createHash('sha256').update(combined).digest('hex');

  await input.client.from('novum_custom_code_events').insert({
    project_id: input.project.id,
    actor_user_id: input.actorUserId,
    scope: 'global',
    target_id: 'combined-custom-code',
    content_hash: contentHash,
    secret_scan_status: status,
    secret_scan_findings: findings,
    preview_required: true,
    preview_checked_at: new Date().toISOString(),
    metadata: {
      snippets: snippets.map(({ scope, targetId, content }) => ({
        scope,
        targetId,
        bytes: Buffer.byteLength(content),
      })),
    },
  });

  return {
    content_hash: contentHash,
    secret_scan_status: status,
    secret_scan_findings: findings,
    snippets_count: snippets.length,
  };
}

async function resolveProjectForRequest(client: any, request: NextRequest, actorUserId: string): Promise<NovumProject | null> {
  const explicitSlug = request.headers.get('x-novum-project-slug') || request.nextUrl.searchParams.get('project');
  if (explicitSlug) return getProjectBySlug(client, explicitSlug);

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
    .maybeSingle();

  if (bySlug.error) return null;
  if (bySlug.data) return bySlug.data;

  const byDomain = await client
    .from('novum_projects')
    .select('id, slug')
    .eq('primary_domain', value)
    .maybeSingle();

  if (byDomain.error || !byDomain.data) return null;
  return byDomain.data;
}

async function getSingleProjectByMembership(client: any, actorUserId: string): Promise<NovumProject | null> {
  const { data, error } = await client
    .from('novum_project_memberships')
    .select('project:novum_projects(id, slug)')
    .eq('user_id', actorUserId);

  if (error || !Array.isArray(data) || data.length !== 1) return null;
  const project = Array.isArray(data[0].project) ? data[0].project[0] : data[0].project;
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

function extractSupabaseAccessToken(request: NextRequest): string | null {
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

async function getCurrentDraftHash(client: any): Promise<string> {
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
    locales,
    translations,
    settings,
  ] = await Promise.all([
    selectDraftRows(client, 'page_folders'),
    selectDraftRows(client, 'pages'),
    selectDraftRows(client, 'page_layers'),
    selectDraftRows(client, 'collections'),
    selectDraftRows(client, 'collection_fields'),
    selectDraftRows(client, 'collection_items'),
    selectDraftRows(client, 'collection_item_values'),
    selectDraftRows(client, 'components'),
    selectDraftRows(client, 'layer_styles'),
    selectDraftRows(client, 'asset_folders'),
    selectDraftRows(client, 'assets'),
    selectDraftRows(client, 'fonts'),
    selectDraftRows(client, 'locales'),
    selectDraftRows(client, 'translations'),
    client
      .from('settings')
      .select('key, value, updated_at')
      .neq('key', 'published_at')
      .order('key', { ascending: true }),
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
    locales,
    translations,
    settings: settings.data || [],
  };

  return crypto.createHash('sha256').update(stableStringify(payload)).digest('hex');
}

async function selectDraftRows(client: any, tableName: string): Promise<unknown[]> {
  const { data, error } = await client
    .from(tableName)
    .select('*')
    .eq('is_published', false)
    .order('id', { ascending: true });

  if (error) {
    throw new Error(`Failed to hash draft table ${tableName}: ${error.message}`);
  }

  return (data || []).map((row: Record<string, unknown>) => {
    const { created_at, updated_at, ...stableRow } = row;
    return stableRow;
  });
}

async function hasValidPreviewApproval(client: any, projectId: string, draftHash: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - PREVIEW_MAX_AGE_HOURS * 60 * 60 * 1000).toISOString();
  const { data, error } = await client
    .from('novum_preview_runs')
    .select('id')
    .eq('project_id', projectId)
    .eq('draft_hash', draftHash)
    .eq('status', 'created')
    .not('actor_user_id', 'is', null)
    .gte('created_at', cutoff)
    .limit(1);

  return !error && Array.isArray(data) && data.length > 0;
}

async function collectCustomCodeSnippets(client: any): Promise<CodeSnippet[]> {
  const snippets: CodeSnippet[] = [];

  const { data: settings } = await client
    .from('settings')
    .select('key, value')
    .in('key', ['custom_code_head', 'custom_code_body']);

  for (const setting of settings || []) {
    if (typeof setting.value === 'string' && setting.value.trim()) {
      snippets.push({ scope: 'global', targetId: setting.key, content: setting.value });
    }
  }

  const { data: pages } = await client
    .from('pages')
    .select('id, settings')
    .eq('is_published', false)
    .is('deleted_at', null);

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

  const { data: pageLayers } = await client
    .from('page_layers')
    .select('page_id, layers')
    .eq('is_published', false)
    .is('deleted_at', null);

  for (const row of pageLayers || []) {
    walkLayers(row.layers, (layer) => {
      const code = layer?.settings?.htmlEmbed?.code;
      if (layer?.name === 'htmlEmbed' && typeof code === 'string' && code.trim()) {
        snippets.push({ scope: 'embed', targetId: `${row.page_id}:${layer.id}`, content: code });
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
