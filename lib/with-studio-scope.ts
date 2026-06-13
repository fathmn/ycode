import type { NextRequest } from 'next/server';
import { requireStudioIntegrationManager } from '@/lib/studio-integration-access';
import { requireStudioProjectRole } from '@/lib/studio-platform';
import type { StudioRoutePolicy } from '@/lib/studio-route-policy';

type StudioRoleGateResult = Awaited<ReturnType<typeof requireStudioProjectRole>>;

export type StudioScopeContext = Extract<StudioRoleGateResult, { ok: true }>['context'];

export type StudioRouteHandlerContext = {
  params?: Promise<Record<string, string | string[]>> | Record<string, string | string[]>;
};

export type StudioScopedRouteHandler<
  TContext extends StudioRouteHandlerContext = StudioRouteHandlerContext,
> = (
  request: NextRequest,
  context: TContext,
  studio: StudioScopeContext | null,
) => Response | Promise<Response>;

/**
 * Future route migration helper.
 *
 * Example later replacement:
 * export const GET = withStudioScope(
 *   STUDIO_ROUTE_POLICIES['GET /ycode/api/assets/[id]'],
 *   async (request, { params }, studio) => { ...existing handler after the inline gate... },
 * );
 *
 * This helper intentionally delegates to the existing Studio gate functions and
 * is not wired into current routes yet.
 */
export function withStudioScope<
  TContext extends StudioRouteHandlerContext = StudioRouteHandlerContext,
>(
  policy: StudioRoutePolicy,
  handler: StudioScopedRouteHandler<TContext>,
) {
  return async function studioScopedRouteHandler(
    request: NextRequest,
    context: TContext,
  ): Promise<Response> {
    if (policy.scope === 'none') {
      return handler(request, context, null);
    }

    const roleCheck = policy.scope === 'integration'
      ? await requireStudioIntegrationManager(request)
      : await requireStudioProjectRole(request, policy.requiredRoles);

    if (!roleCheck.ok) return roleCheck.response;

    return handler(request, context, roleCheck.context);
  };
}
