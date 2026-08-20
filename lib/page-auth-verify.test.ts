import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import * as supabaseServer from '@/lib/supabase-server';

interface FakeRow {
  id: string;
  project_id: string;
  settings: unknown;
  is_published: boolean;
  deleted_at: string | null;
}

interface QueryResult {
  data: FakeRow[];
  error: null;
}

class FakeQuery {
  private filters: Array<(row: FakeRow) => boolean> = [];
  private resultLimit: number | null = null;

  constructor(
    private readonly rows: FakeRow[],
    private readonly executedFilters: Array<{ table: string; fields: string; projectId?: string }>,
    private readonly table: string,
    private fields = '*',
  ) {}

  select(fields: string): this {
    this.fields = fields;
    return this;
  }

  eq(column: keyof FakeRow, value: unknown): this {
    this.filters.push((row) => row[column] === value);
    if (column === 'project_id' && typeof value === 'string') {
      this.executedFilters.push({ table: this.table, fields: this.fields, projectId: value });
    }
    return this;
  }

  is(column: keyof FakeRow, value: unknown): this {
    this.filters.push((row) => row[column] === value);
    return this;
  }

  limit(value: number): this {
    this.resultLimit = value;
    return this;
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    const filteredRows = this.rows.filter((row) => this.filters.every((filter) => filter(row)));
    const data = this.resultLimit == null ? filteredRows : filteredRows.slice(0, this.resultLimit);
    return Promise.resolve({ data, error: null }).then(onfulfilled, onrejected);
  }
}

class FakeSupabase {
  readonly projectFilters: Array<{ table: string; fields: string; projectId?: string }> = [];

  constructor(private readonly tables: Record<string, FakeRow[]>) {}

  from(table: string): FakeQuery {
    return new FakeQuery(this.tables[table] || [], this.projectFilters, table);
  }
}

function protectedSettings(password: string, enabled = true) {
  return { auth: { enabled, password } };
}

function decodeCookiePayload(cookieValue: string): { pages: string[]; folders: string[] } {
  const [encodedPayload] = cookieValue.split('.');
  return JSON.parse(Buffer.from(encodedPayload, 'base64').toString('utf8'));
}

test('page verify unlocks only same-project pages and folders with the same password', async (t) => {
  const projectOne = '11111111-1111-4111-8111-111111111111';
  const projectTwo = '22222222-2222-4222-8222-222222222222';
  const pageA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const pageB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const pageC = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const pageD = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const folderA = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const folderOtherProject = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

  const row = (id: string, project_id: string, settings: unknown): FakeRow => ({
    id,
    project_id,
    settings,
    is_published: true,
    deleted_at: null,
  });
  const fakeSupabase = new FakeSupabase({
    pages: [
      row(pageA, projectOne, protectedSettings('password-x')),
      row(pageB, projectOne, JSON.stringify(protectedSettings('password-x'))),
      row(pageC, projectOne, protectedSettings('password-y')),
      row(pageD, projectTwo, protectedSettings('password-x')),
    ],
    page_folders: [
      row(folderA, projectOne, protectedSettings('password-x')),
      row(folderOtherProject, projectTwo, protectedSettings('password-x')),
    ],
  });

  mock.method(
    supabaseServer,
    'getSupabaseAdmin',
    async () => fakeSupabase as unknown as Awaited<ReturnType<typeof supabaseServer.getSupabaseAdmin>>,
  );
  t.after(() => mock.restoreAll());

  const { POST } = await import('@/app/(site)/api/page-auth/verify/route');
  const request = new NextRequest('https://project-one.example/api/page-auth/verify', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': '198.51.100.41',
    },
    body: JSON.stringify({
      pageId: pageA,
      password: 'password-x',
      redirectUrl: '/protected-a',
      isPublished: true,
    }),
  });

  const response = await POST(request);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    success: true,
    redirectUrl: '/protected-a',
  });

  const authCookie = response.cookies.get('ycode_page_auth');
  assert.ok(authCookie?.value, 'expected the signed page-auth cookie');
  const payload = decodeCookiePayload(authCookie.value);
  assert.deepEqual(new Set(payload.pages), new Set([pageA, pageB]));
  assert.deepEqual(payload.folders, [folderA]);
  assert.ok(!payload.pages.includes(pageC), 'different-password page must remain locked');
  assert.ok(!payload.pages.includes(pageD), 'same-password page from another project must remain locked');
  assert.ok(
    !payload.folders.includes(folderOtherProject),
    'same-password folder from another project must remain locked',
  );

  assert.ok(
    fakeSupabase.projectFilters.some(
      ({ table, fields, projectId }) => table === 'pages'
        && fields === 'id, settings'
        && projectId === projectOne,
    ),
    'matching page lookup must be scoped to the verified page project',
  );
  assert.ok(
    fakeSupabase.projectFilters.some(
      ({ table, fields, projectId }) => table === 'page_folders'
        && fields === 'id, settings'
        && projectId === projectOne,
    ),
    'matching folder lookup must be scoped to the verified page project',
  );
});
