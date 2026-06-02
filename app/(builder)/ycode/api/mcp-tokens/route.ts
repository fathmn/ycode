import { NextRequest } from 'next/server';
import { getAllTokens, createToken } from '@/lib/repositories/mcpTokenRepository';
import { noCache } from '@/lib/api-response';
import { requireStudioProjectRole, type StudioProjectRole } from '@/lib/studio-platform';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const MCP_TOKEN_ROLES: StudioProjectRole[] = [
  'studio_admin',
  'studio_developer',
  'customer_owner',
];

/**
 * GET /ycode/api/mcp-tokens
 * List all MCP tokens
 */
export async function GET(request: NextRequest) {
  try {
    const roleCheck = await requireStudioProjectRole(request, MCP_TOKEN_ROLES);
    if (!roleCheck.ok) return roleCheck.response;
    const projectId = roleCheck.context.project.id;

    const tokens = await getAllTokens(projectId);

    return noCache({ data: tokens });
  } catch (error) {
    console.error('Error fetching MCP tokens:', error);
    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to fetch MCP tokens' },
      500,
    );
  }
}

/**
 * POST /ycode/api/mcp-tokens
 * Generate a new MCP token. Returns the full token URL (shown only once).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const roleCheck = await requireStudioProjectRole(request, MCP_TOKEN_ROLES);
    if (!roleCheck.ok) return roleCheck.response;
    const projectId = roleCheck.context.project.id;

    const { name } = body;

    if (!name || typeof name !== 'string' || name.trim() === '') {
      return noCache({ error: 'Name is required' }, 400);
    }

    const token = await createToken(name.trim(), projectId);

    const host = request.headers.get('host') || 'localhost:3000';
    const protocol = request.headers.get('x-forwarded-proto') || 'http';
    const mcpUrl = `${protocol}://${host}/ycode/mcp/${token.token}`;

    return noCache({
      data: {
        ...token,
        mcp_url: mcpUrl,
      },
    }, 201);
  } catch (error) {
    console.error('Error creating MCP token:', error);
    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to create MCP token' },
      500,
    );
  }
}
