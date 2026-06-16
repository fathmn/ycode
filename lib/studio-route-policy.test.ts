import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { STUDIO_ROUTE_POLICIES } from '@/lib/studio-route-policy';

const VALID_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const VALID_SCOPES = new Set(['project', 'integration', 'none']);
const STUDIO_WRITE_ROLE_NAMES = [
  'studio_admin',
  'studio_developer',
  'customer_owner',
  'customer_editor',
];

function routePatternFromKey(key: string, method?: string): string {
  const prefix = method ? `${method} ` : '';
  return prefix && key.startsWith(prefix) ? key.slice(prefix.length) : key;
}

function routeParams(routePattern: string): string[] {
  return Array.from(routePattern.matchAll(/\[([^\]]+)\]/g), (match) => match[1]);
}

test('studio route policies are well-formed', () => {
  const entries = Object.entries(STUDIO_ROUTE_POLICIES);
  assert.ok(entries.length > 0, 'expected at least one Studio route policy');

  for (const [key, policy] of entries) {
    assert.ok(policy.method, `${key} must declare its HTTP method`);
    assert.ok(VALID_METHODS.has(policy.method), `${key} has an unsupported HTTP method`);
    assert.ok(key.startsWith(`${policy.method} `), `${key} must be keyed by method and route pattern`);
    assert.ok(VALID_SCOPES.has(policy.scope), `${key} has an unsupported scope`);
    assert.ok(Array.isArray(policy.requiredRoles), `${key} must declare requiredRoles`);

    if (policy.scope !== 'none') {
      assert.ok(policy.requiredRoles.length > 0, `${key} must declare roles for scoped policies`);
    }

    const routePattern = routePatternFromKey(key, policy.method);
    assert.ok(routePattern.startsWith('/ycode/api/'), `${key} must target a Ycode API route`);

    if (routePattern.includes('[id]')) {
      assert.ok(policy.resourceParam, `${key} must declare resourceParam for [id] routes`);
    }

    if (policy.resourceParam) {
      const params = routeParams(routePattern);
      assert.ok(
        params.includes(policy.resourceParam),
        `${key} resourceParam must match one of its route params`,
      );
    }
  }
});

test('css generation routes are project-scoped Studio write policies', () => {
  for (const route of [
    'POST /ycode/api/css/generate',
    'POST /ycode/api/css/generate-pages',
  ]) {
    const policy = STUDIO_ROUTE_POLICIES[route];
    assert.ok(policy, `${route} must be registered in Studio route policies`);
    assert.equal(policy.method, 'POST');
    assert.equal(policy.scope, 'project');
    assert.deepEqual(policy.requiredRoles, STUDIO_WRITE_ROLE_NAMES);
  }
});

test('css generation handlers use the authenticated project scope', () => {
  const generateRoute = fs.readFileSync(
    path.join(process.cwd(), 'app/(builder)/ycode/api/css/generate/route.ts'),
    'utf8',
  );
  assert.match(generateRoute, /requireStudioProjectRole\(request,\s*CSS_GENERATE_ROLES\)/);
  assert.match(generateRoute, /const projectId = roleCheck\.context\.project\.id;/);
  assert.match(generateRoute, /generateAndSaveDraftCSS\(projectId\)/);

  const generatePagesRoute = fs.readFileSync(
    path.join(process.cwd(), 'app/(builder)/ycode/api/css/generate-pages/route.ts'),
    'utf8',
  );
  assert.match(generatePagesRoute, /requireStudioProjectRole\(request,\s*CSS_GENERATE_PAGE_ROLES\)/);
  assert.match(generatePagesRoute, /const projectId = roleCheck\.context\.project\.id;/);
  assert.match(generatePagesRoute, /generateCSSForPage\(pageIds\[0\], projectId\)/);
  assert.match(generatePagesRoute, /generateCSSForPages\(pageIds, projectId\)/);
});
