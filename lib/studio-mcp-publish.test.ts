import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import * as projectScope from '@/lib/project-scope';
import { resolveMcpProjectId } from '@/lib/mcp/project-context';
import { publishStudioContextFromMcp } from '@/lib/mcp/tools/publishing';
import {
  recordStudioPreviewApprovalForContext,
  StudioPreviewApprovalError,
  type StudioProjectContext,
  verifyStudioPublishGateForContext,
  writeStudioAuditLogForContext,
} from '@/lib/studio-platform';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const FOREIGN_PROJECT_ID = '22222222-2222-4222-8222-222222222222';

type RecordedInsert = { table: string; value: Record<string, unknown> };
type RecordedGte = { table: string; column: string; value: unknown };

class StubQuery {
  private operation: 'select' | 'insert' | 'update' | 'delete' = 'select';
  private insertedValue: Record<string, unknown> | null = null;
  private selectedColumns: string | undefined;
  private equalFilters = new Map<string, unknown>();
  private gteFilters = new Map<string, unknown>();

  constructor(
    private readonly table: string,
    private readonly inserts: RecordedInsert[],
    private readonly previewApproved: boolean,
    private readonly renderedPreviewCreatedAt: string | null,
    private readonly recordedGte: RecordedGte[]
  ) {}

  select(columns?: string) {
    this.selectedColumns = columns;
    return this;
  }
  eq(column: string, value: unknown) {
    this.equalFilters.set(column, value);
    return this;
  }
  neq() { return this; }
  not() { return this; }
  in() { return this; }
  is() { return this; }
  gte(column: string, value: unknown) {
    this.gteFilters.set(column, value);
    this.recordedGte.push({ table: this.table, column, value });
    return this;
  }
  gt() { return this; }
  order() { return this; }
  limit() { return this; }

  insert(value: Record<string, unknown>) {
    this.operation = 'insert';
    this.insertedValue = value;
    this.inserts.push({ table: this.table, value });
    return this;
  }

  update(value: Record<string, unknown>) {
    this.operation = 'update';
    this.insertedValue = value;
    return this;
  }

  delete() {
    this.operation = 'delete';
    return this;
  }

  private result(single = false) {
    if (this.table === 'studio_projects' && single) {
      return {
        data: { id: PROJECT_ID, slug: 'kundenprojekt-studio', metadata: {} },
        error: null,
      };
    }
    if (this.operation === 'insert' && single) {
      return {
        data: {
          id: 'preview-run-id',
          preview_url: '/studio/preview?project=kundenprojekt',
          draft_hash: '0'.repeat(64),
          created_at: new Date().toISOString(),
          ...(this.insertedValue || {}),
        },
        error: null,
      };
    }
    if (
      this.table === 'studio_preview_runs'
      && this.selectedColumns === 'id, preview_url, actor_user_id, created_at, metadata'
      && this.renderedPreviewCreatedAt
    ) {
      const previewNonceHash = 'a'.repeat(64);
      const cutoff = this.gteFilters.get('created_at');
      const rows = [{
        id: 'rendered-preview-run-id',
        preview_url: '/studio/preview?project=kundenprojekt',
        actor_user_id: '33333333-3333-4333-8333-333333333333',
        created_at: this.renderedPreviewCreatedAt,
        metadata: {
          serverSideRenderProof: true,
          rawNonceHash: 'b'.repeat(64),
          previewNonceHash,
          previewNonceDraftHash: 'c'.repeat(64),
          previewNonceIssuedAt: this.renderedPreviewCreatedAt,
          renderArtifact: {
            kind: 'studio-preview-server-render',
            reportPath: '/studio/preview?project=kundenprojekt',
            generatedAt: this.renderedPreviewCreatedAt,
            pairCount: 1,
            failingPairs: [],
            previewNonceHash,
          },
        },
      }].filter((row) => (
        typeof cutoff !== 'string' || row.created_at >= cutoff
      ));
      return { data: rows, error: null };
    }
    if (this.table === 'studio_preview_runs' && this.previewApproved) {
      if (single && this.equalFilters.get('id') === 'rendered-preview-run-id') {
        const previewNonceHash = 'a'.repeat(64);
        return {
          data: {
            id: 'rendered-preview-run-id',
            metadata: {
              serverSideRenderProof: true,
              rawNonceHash: 'b'.repeat(64),
              previewNonceHash,
              previewNonceDraftHash: 'c'.repeat(64),
              previewNonceIssuedAt: new Date().toISOString(),
              renderArtifact: {
                kind: 'studio-preview-server-render',
                reportPath: '/studio/preview?project=kundenprojekt-studio',
                generatedAt: new Date().toISOString(),
                pairCount: 1,
                failingPairs: [],
                previewNonceHash,
              },
            },
          },
          error: null,
        };
      }
      if (this.selectedColumns === 'id, actor_user_id, created_at, metadata') {
        return {
          data: [{
            id: 'preview-approval-run-id',
            actor_user_id: '33333333-3333-4333-8333-333333333333',
            created_at: new Date().toISOString(),
            metadata: {
              explicitApproval: true,
              renderedPreviewRunId: 'rendered-preview-run-id',
            },
          }],
          error: null,
        };
      }
    }
    return { data: single ? null : [], error: null };
  }

  single() { return Promise.resolve(this.result(true)); }
  maybeSingle() { return Promise.resolve(this.result(true)); }
  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) {
    return Promise.resolve(this.result()).then(onfulfilled, onrejected);
  }
}

function createStubContext(options: {
  actorUserId?: string | null;
  role?: StudioProjectContext['role'];
  source?: string;
  previewApproved?: boolean;
  renderedPreviewCreatedAt?: string;
} = {}): { context: StudioProjectContext; inserts: RecordedInsert[]; recordedGte: RecordedGte[] } {
  const inserts: RecordedInsert[] = [];
  const recordedGte: RecordedGte[] = [];
  const client = {
    from(table: string) {
      return new StubQuery(
        table,
        inserts,
        options.previewApproved === true,
        options.renderedPreviewCreatedAt || null,
        recordedGte
      );
    },
  };
  return {
    inserts,
    recordedGte,
    context: {
      client,
      project: { id: PROJECT_ID, slug: 'kundenprojekt-studio', metadata: {} },
      actorUserId: options.actorUserId === undefined
        ? '33333333-3333-4333-8333-333333333333'
        : options.actorUserId,
      role: options.role === undefined ? 'customer_owner' : options.role,
      tokenId: 'mcp-token-id',
      source: options.source === undefined ? 'mcp' : options.source,
    },
  };
}

function withPublishEnvironment(callback: () => Promise<void>) {
  const previous = {
    scoped: process.env.STUDIO_PROJECT_SCOPED_LIVE_PUBLISH,
    trusted: process.env.STUDIO_TRUSTED_PREVIEW_RENDER_PROOF,
  };
  process.env.STUDIO_PROJECT_SCOPED_LIVE_PUBLISH = '1';
  process.env.STUDIO_TRUSTED_PREVIEW_RENDER_PROOF = '1';
  return callback().finally(() => {
    if (previous.scoped === undefined) delete process.env.STUDIO_PROJECT_SCOPED_LIVE_PUBLISH;
    else process.env.STUDIO_PROJECT_SCOPED_LIVE_PUBLISH = previous.scoped;
    if (previous.trusted === undefined) delete process.env.STUDIO_TRUSTED_PREVIEW_RENDER_PROOF;
    else process.env.STUDIO_TRUSTED_PREVIEW_RENDER_PROOF = previous.trusted;
  });
}

test('publish über MCP wird ohne gültige Preview-Freigabe für den aktuellen Draft-Hash abgewiesen', { concurrency: false }, async () => {
  await withPublishEnvironment(async () => {
    const { context, inserts } = createStubContext();
    const result = await publishStudioContextFromMcp(context);

    assert.equal(result.success, false);
    assert.equal(result.code, 'STUDIO_PREVIEW_REQUIRED');
    assert.ok(inserts.some(({ table, value }) => (
      table === 'studio_audit_logs'
      && value.action === 'site.publish.blocked.preview_required'
      && (value.metadata as Record<string, unknown>).source === 'mcp'
      && (value.metadata as Record<string, unknown>).tokenId === 'mcp-token-id'
    )));
  });
});

test('publish über MCP ohne Actor wird fail-closed mit Rollenfehler abgewiesen', { concurrency: false }, async () => {
  await withPublishEnvironment(async () => {
    const { context, inserts } = createStubContext({ actorUserId: null, role: null });
    const result = await publishStudioContextFromMcp(context);

    assert.equal(result.success, false);
    assert.equal(result.code, 'STUDIO_PUBLISH_ROLE_REQUIRED');
    assert.match(String(result.message), /Integrationen → MCP neu/);
    assert.ok(inserts.some(({ table, value }) => (
      table === 'studio_audit_logs'
      && value.action === 'site.publish.blocked.insufficient_role'
      && value.actor_user_id === null
    )));
  });
});

test('publish über MCP mit customer_editor wird mit Rollenfehler abgewiesen', { concurrency: false }, async () => {
  await withPublishEnvironment(async () => {
    const { context, inserts } = createStubContext({ role: 'customer_editor' });
    const result = await publishStudioContextFromMcp(context);

    assert.equal(result.success, false);
    assert.equal(result.code, 'STUDIO_PUBLISH_ROLE_REQUIRED');
    assert.ok(inserts.some(({ table, value }) => (
      table === 'studio_audit_logs'
      && value.action === 'site.publish.blocked.insufficient_role'
    )));
  });
});

test('publish über MCP wird abgewiesen, wenn livePublishAvailable false ist', { concurrency: false }, async () => {
  const previousScoped = process.env.STUDIO_PROJECT_SCOPED_LIVE_PUBLISH;
  const previousTrusted = process.env.STUDIO_TRUSTED_PREVIEW_RENDER_PROOF;
  delete process.env.STUDIO_PROJECT_SCOPED_LIVE_PUBLISH;
  delete process.env.STUDIO_TRUSTED_PREVIEW_RENDER_PROOF;
  try {
    const { context } = createStubContext();
    const result = await publishStudioContextFromMcp(context);
    assert.equal(result.success, false);
    assert.equal(result.code, 'STUDIO_PROJECT_SCOPED_PUBLISH_REQUIRED');
  } finally {
    if (previousScoped !== undefined) process.env.STUDIO_PROJECT_SCOPED_LIVE_PUBLISH = previousScoped;
    if (previousTrusted !== undefined) process.env.STUDIO_TRUSTED_PREVIEW_RENDER_PROOF = previousTrusted;
  }
});

test('approve_preview verlangt einen Browser-Render-Proof und erzeugt selbst keinen Preview-Run', { concurrency: false }, async () => {
  const { context, inserts } = createStubContext();

  await assert.rejects(
    () => recordStudioPreviewApprovalForContext(
      context,
      '/studio/preview?project=kundenprojekt'
    ),
    (error: unknown) => (
      error instanceof StudioPreviewApprovalError
      && error.code === 'STUDIO_PREVIEW_RENDER_REQUIRED'
    )
  );
  assert.equal(inserts.filter(({ table }) => table === 'studio_preview_runs').length, 0);
});

test('approve_preview akzeptiert einen 45 Minuten alten gespeicherten Render-Nachweis', { concurrency: false }, async () => {
  const renderedPreviewCreatedAt = new Date(Date.now() - 45 * 60 * 1000).toISOString();
  const { context, inserts, recordedGte } = createStubContext({ renderedPreviewCreatedAt });

  const result = await recordStudioPreviewApprovalForContext(
    context,
    '/studio/preview?project=kundenprojekt'
  );

  const renderProofCutoff = recordedGte.find(({ table, column }) => (
    table === 'studio_preview_runs' && column === 'created_at'
  ));
  assert.ok(renderProofCutoff);
  assert.ok(renderedPreviewCreatedAt >= String(renderProofCutoff.value));
  assert.equal(result.data.preview_url, '/studio/preview?project=kundenprojekt');
  assert.ok(inserts.some(({ table, value }) => (
    table === 'studio_preview_runs'
    && (value.metadata as Record<string, unknown>).renderedPreviewRunId === 'rendered-preview-run-id'
  )));
});

test('approve_preview weist einen mehr als 24 Stunden alten Render-Nachweis weiterhin ab', { concurrency: false }, async () => {
  const renderedPreviewCreatedAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  const { context, recordedGte } = createStubContext({ renderedPreviewCreatedAt });

  await assert.rejects(
    () => recordStudioPreviewApprovalForContext(
      context,
      '/studio/preview?project=kundenprojekt'
    ),
    (error: unknown) => (
      error instanceof StudioPreviewApprovalError
      && error.code === 'STUDIO_PREVIEW_RENDER_REQUIRED'
    )
  );

  const renderProofCutoff = recordedGte.find(({ table, column }) => (
    table === 'studio_preview_runs' && column === 'created_at'
  ));
  assert.ok(renderProofCutoff);
  assert.ok(renderedPreviewCreatedAt < String(renderProofCutoff.value));
});

test('approve_preview über MCP ohne Actor wird abgewiesen und schreibt keinen Preview-Run', { concurrency: false }, async () => {
  const { context, inserts } = createStubContext({
    actorUserId: null,
    role: null,
    previewApproved: true,
  });

  await assert.rejects(
    () => recordStudioPreviewApprovalForContext(
      context,
      '/studio/preview?project=kundenprojekt'
    ),
    (error: unknown) => (
      error instanceof StudioPreviewApprovalError
      && error.code === 'STUDIO_PREVIEW_APPROVAL_ROLE_REQUIRED'
      && /Integrationen → MCP neu/.test(error.message)
    )
  );
  assert.equal(inserts.filter(({ table }) => table === 'studio_preview_runs').length, 0);
});

test('Publish-Gate bleibt für den Request-Pfad mit gültiger Rolle erfolgreich', { concurrency: false }, async () => {
  await withPublishEnvironment(async () => {
    const { context } = createStubContext({ previewApproved: true });
    context.source = undefined;
    context.tokenId = undefined;
    const result = await verifyStudioPublishGateForContext(context);

    assert.equal(result.ok, true);
  });
});

test('ein fremder Projekt-Slug erweitert den MCP-Token-Scope nicht', { concurrency: false }, async () => {
  const resolver = mock.method(
    projectScope,
    'resolveStudioProjectId',
    async () => FOREIGN_PROJECT_ID
  );
  try {
    await assert.rejects(
      () => resolveMcpProjectId({ projectId: PROJECT_ID }, 'fremdes-projekt'),
      /not authorized/
    );
  } finally {
    resolver.mock.restore();
  }
});

test('verpflichtende MCP-Audit-Einträge schlagen bei einem Datenbankfehler hart fehl', async () => {
  const consoleError = mock.method(console, 'error', () => {});
  const context: StudioProjectContext = {
    client: {
      from() {
        return {
          async insert() {
            return { data: null, error: { message: 'audit unavailable' } };
          },
        };
      },
    },
    project: { id: PROJECT_ID, slug: 'kundenprojekt-studio' },
    actorUserId: '33333333-3333-4333-8333-333333333333',
    role: 'customer_owner',
    tokenId: 'mcp-token-id',
    source: 'mcp',
  };

  try {
    await assert.rejects(
      () => writeStudioAuditLogForContext({
        context,
        action: 'site.publish.requested',
        entityType: 'site',
        required: true,
      }),
      /audit unavailable/
    );
  } finally {
    consoleError.mock.restore();
  }
});
