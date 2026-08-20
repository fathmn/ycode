import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import * as supabaseServer from '@/lib/supabase-server';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const PAGE_ID = '22222222-2222-4222-8222-222222222222';
const PAGE_LAYERS_ID = '33333333-3333-4333-8333-333333333333';

type Row = Record<string, any>;

class FakeQuery {
  private operation: 'select' | 'update' | 'upsert' = 'select';
  private filters: Array<(row: Row) => boolean> = [];
  private updateValue: Row | null = null;
  private upsertValue: Row[] = [];
  private rowLimit: number | null = null;

  constructor(
    private readonly table: string,
    private readonly tables: Map<string, Row[]>,
  ) {}

  select() { return this; }
  order() { return this; }

  limit(value: number) {
    this.rowLimit = value;
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push(row => row[column] === value);
    return this;
  }

  is(column: string, value: unknown) {
    this.filters.push(row => row[column] === value);
    return this;
  }

  in(column: string, values: unknown[]) {
    this.filters.push(row => values.includes(row[column]));
    return this;
  }

  update(value: Row) {
    this.operation = 'update';
    this.updateValue = value;
    return this;
  }

  upsert(value: Row | Row[]) {
    this.operation = 'upsert';
    this.upsertValue = Array.isArray(value) ? value : [value];
    return this;
  }

  private execute(single: boolean) {
    const rows = this.tables.get(this.table) ?? [];

    if (this.operation === 'update') {
      const matches = rows.filter(row => this.filters.every(filter => filter(row)));
      for (const row of matches) Object.assign(row, this.updateValue);
      return this.result(matches, single);
    }

    if (this.operation === 'upsert') {
      for (const incoming of this.upsertValue) {
        const existing = rows.find(row => (
          row.id === incoming.id && row.is_published === incoming.is_published
        ));
        if (existing) Object.assign(existing, incoming);
        else rows.push({ ...incoming });
      }
      this.tables.set(this.table, rows);
      return this.result(this.upsertValue, single);
    }

    let matches = rows.filter(row => this.filters.every(filter => filter(row)));
    if (this.rowLimit !== null) matches = matches.slice(0, this.rowLimit);
    return this.result(matches, single);
  }

  private result(rows: Row[], single: boolean) {
    if (single) {
      if (rows.length === 0) {
        return { data: null, error: { code: 'PGRST116', message: 'No rows found' } };
      }
      return { data: rows[0], error: null };
    }
    return { data: rows, error: null };
  }

  single() { return Promise.resolve(this.execute(true)); }
  maybeSingle() { return Promise.resolve(this.execute(true)); }

  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return Promise.resolve(this.execute(false)).then(onfulfilled, onrejected);
  }
}

test('page CSS is regenerated before publish snapshots a newly used layer class', { concurrency: false }, async () => {
  const tables = new Map<string, Row[]>([
    ['pages', [{ id: PAGE_ID, project_id: PROJECT_ID, is_published: false, deleted_at: null }]],
    ['page_layers', [{
      id: PAGE_LAYERS_ID,
      page_id: PAGE_ID,
      project_id: PROJECT_ID,
      layers: [{ id: 'body', name: 'body', classes: 'col-span-1', children: [] }],
      generated_css: '/* stale */',
      content_hash: 'stale-hash',
      is_published: false,
      deleted_at: null,
      created_at: '2026-08-20T00:00:00.000Z',
      updated_at: '2026-08-20T00:00:00.000Z',
    }]],
    ['components', []],
  ]);

  const fakeSupabase = {
    from(table: string) {
      return new FakeQuery(table, tables);
    },
  };

  mock.method(
    supabaseServer,
    'getSupabaseAdmin',
    async () => fakeSupabase as unknown as Awaited<ReturnType<typeof supabaseServer.getSupabaseAdmin>>,
  );

  try {
    const { upsertDraftLayers, batchPublishPageLayers } = await import('@/lib/repositories/pageLayersRepository');
    const { regeneratePageCssBeforePublish } = await import('@/lib/studio-publish-service');

    const newLayers = [{ id: 'body', name: 'body', classes: 'col-span-7', children: [] }];
    await upsertDraftLayers(PAGE_ID, newLayers, undefined, undefined, PROJECT_ID);

    await regeneratePageCssBeforePublish([PAGE_ID], PROJECT_ID);
    await batchPublishPageLayers([PAGE_ID], PROJECT_ID);

    const pageLayerRows = tables.get('page_layers') ?? [];
    const draft = pageLayerRows.find(row => row.is_published === false);
    const published = pageLayerRows.find(row => row.is_published === true);

    assert.match(draft?.generated_css ?? '', /\.col-span-7\b/);
    assert.match(published?.generated_css ?? '', /\.col-span-7\b/);
    assert.deepEqual(published?.layers, newLayers);
    assert.equal(published?.content_hash, draft?.content_hash);
  } finally {
    mock.restoreAll();
  }
});
