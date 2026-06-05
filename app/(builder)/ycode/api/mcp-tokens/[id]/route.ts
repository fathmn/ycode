import { NextRequest } from 'next/server';
import { getTokenById, deleteToken } from '@/lib/repositories/mcpTokenRepository';
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
 * GET /ycode/api/mcp-tokens/[id]
 * Get a single MCP token by ID
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const roleCheck = await requireStudioProjectRole(request, MCP_TOKEN_ROLES);
    if (!roleCheck.ok) return roleCheck.response;
    const projectId = roleCheck.context.project.id;

    const { id } = await params;
    const token = await getTokenById(id, projectId);

    if (!token) {
      return noCache({ error: 'MCP-Verbindung nicht gefunden.' }, 404);
    }

    return noCache({ data: token });
  } catch (error) {
    console.error('Error fetching MCP token:', error);
    return noCache(
      { error: error instanceof Error ? error.message : 'MCP-Verbindung konnte nicht geladen werden.' },
      500,
    );
  }
}

/**
 * DELETE /ycode/api/mcp-tokens/[id]
 * Delete an MCP token
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const roleCheck = await requireStudioProjectRole(request, MCP_TOKEN_ROLES);
    if (!roleCheck.ok) return roleCheck.response;
    const projectId = roleCheck.context.project.id;

    const { id } = await params;

    const existing = await getTokenById(id, projectId);
    if (!existing) {
      return noCache({ error: 'MCP-Verbindung nicht gefunden.' }, 404);
    }

    await deleteToken(id, projectId);

    return noCache({ data: { deleted: true, id } });
  } catch (error) {
    console.error('Error deleting MCP token:', error);
    return noCache(
      { error: error instanceof Error ? error.message : 'MCP-Verbindung konnte nicht gelöscht werden.' },
      500,
    );
  }
}
