import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getUnpublishedPages } from '@/lib/repositories/pageRepository';
import { getStudioPublishReadiness } from '@/lib/studio-platform';
import type { McpProjectContext } from '@/lib/mcp/project-context';

export function registerPublishingTools(server: McpServer, projectContext: McpProjectContext = {}) {
  server.tool(
    'get_unpublished_changes',
    'Check what page changes are pending and need to be published for this Studio project.',
    {},
    async () => {
      const pages = await getUnpublishedPages(projectContext.projectId).catch(() => []);

      const hasChanges = pages.length > 0;

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            has_unpublished_changes: hasChanges,
            unpublished_pages: pages.map((p) => ({ id: p.id, name: p.name })),
            disabled_unscoped_categories: [
              'collections',
              'components',
              'assets',
              'asset_folders',
              'color_variables',
              'fonts',
              'locales',
            ],
          }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'publish',
    'Publish all draft changes to make them live. This publishes pages, collections, components, styles, assets, and regenerates CSS.',
    {},
    async () => {
      const readiness = getStudioPublishReadiness();
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            success: false,
            blocked: true,
            message: readiness.blockerMessage || 'Studio live publish is blocked.',
          }, null, 2),
        }],
        isError: true,
      };
    },
  );
}
