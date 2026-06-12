/**
 * MCP Server Factory
 *
 * Creates a new McpServer instance with all tools and resources registered.
 * Each HTTP session gets its own server instance.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SYSTEM_INSTRUCTIONS } from '@/lib/mcp/instructions';
import { registerPageTools } from '@/lib/mcp/tools/pages';
import { registerPageFolderTools } from '@/lib/mcp/tools/page-folders';
import { registerLayerTools } from '@/lib/mcp/tools/layers';
import { registerBatchTools } from '@/lib/mcp/tools/batch';
import { registerLayoutTools } from '@/lib/mcp/tools/layouts';
import { registerCollectionTools } from '@/lib/mcp/tools/collections';
import { registerCollectionLayerTools } from '@/lib/mcp/tools/collection-layers';
import { registerStyleTools } from '@/lib/mcp/tools/styles';
import { registerAssetTools } from '@/lib/mcp/tools/assets';
import { registerAssetFolderTools } from '@/lib/mcp/tools/asset-folders';
import { registerComponentTools } from '@/lib/mcp/tools/components';
import { registerColorVariableTools } from '@/lib/mcp/tools/color-variables';
import { registerFontTools } from '@/lib/mcp/tools/fonts';
import { registerLocaleTools } from '@/lib/mcp/tools/locales';
import { registerFormTools } from '@/lib/mcp/tools/forms';
import { registerSettingsTools } from '@/lib/mcp/tools/settings';
import { registerPublishingTools } from '@/lib/mcp/tools/publishing';
import { registerAnimationTools } from '@/lib/mcp/tools/animations';
import { registerReferenceResources } from '@/lib/mcp/resources/reference';
import { registerSiteResources } from '@/lib/mcp/resources/site';
import type { McpProjectContext } from '@/lib/mcp/project-context';

export function createMcpServer(projectContext: McpProjectContext = {}): McpServer {
  const server = new McpServer(
    { name: 'studio', version: '0.4.0' },
    { instructions: SYSTEM_INSTRUCTIONS },
  );

  registerPageTools(server, projectContext);
  registerPageFolderTools(server, projectContext);
  registerLayerTools(server, projectContext);
  registerBatchTools(server, projectContext);
  registerLayoutTools(server, projectContext);
  registerCollectionTools(server);
  registerCollectionLayerTools(server);
  registerStyleTools(server, projectContext);
  registerAssetTools(server);
  registerAssetFolderTools(server);
  registerComponentTools(server);
  registerColorVariableTools(server, projectContext);
  registerFontTools(server);
  registerLocaleTools(server);
  registerFormTools(server, projectContext);
  registerSettingsTools(server, projectContext);
  registerPublishingTools(server, projectContext);
  registerAnimationTools(server);

  registerReferenceResources(server);
  registerSiteResources(server, projectContext);

  return server;
}
