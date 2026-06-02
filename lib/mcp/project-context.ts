import { resolveStudioProjectId } from '@/lib/project-scope';

export type McpProjectContext = {
  projectId?: string | null;
};

export async function resolveMcpProjectId(
  context: McpProjectContext | undefined,
  project?: string
): Promise<string | null> {
  if (!project) return context?.projectId || null;

  const resolvedProjectId = await resolveStudioProjectId(project);
  if (!resolvedProjectId) {
    throw new Error('Studio project not found for MCP request');
  }
  if (context?.projectId && resolvedProjectId !== context.projectId) {
    throw new Error('MCP token is not authorized for the requested Studio project');
  }
  return resolvedProjectId;
}
