import { addCorsHeaders } from '@/lib/mcp/handler';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * OAuth Bearer-token MCP endpoint — DISABLED in the Studio fork.
 *
 * Upstream Ycode 1.21.1 introduced this endpoint for OAuth-authenticated MCP
 * clients (Claude.ai web, ChatGPT). Its OAuth access tokens carry no project
 * binding (`project_id`), and the shared handler creates MCP servers without
 * a project context. In the multi-project Studio platform that would grant a
 * single OAuth token unscoped access across ALL projects.
 *
 * Studio policy is fail-closed: this endpoint is disabled until OAuth tokens
 * are project-bound and the shared MCP handler enforces tokenId + projectId
 * on every session (see `/ycode/mcp/[token]` for the enforced pattern).
 */

function disabledResponse(): Response {
  return addCorsHeaders(new Response(JSON.stringify({
    error: 'mcp_oauth_disabled',
    message: 'The OAuth Bearer-token MCP endpoint is disabled in Studio: OAuth access tokens are not bound to a project, which would allow unscoped cross-project access. Use a project-scoped MCP token via /ycode/mcp/<token> instead.',
  }), {
    status: 503,
    headers: { 'Content-Type': 'application/json' },
  }));
}

export async function POST() {
  return disabledResponse();
}

export async function GET() {
  return disabledResponse();
}

export async function DELETE() {
  return disabledResponse();
}

export async function OPTIONS() {
  return addCorsHeaders(new Response(null, { status: 204 }));
}
