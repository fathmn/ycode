import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getAllPages } from '@/lib/repositories/pageRepository';
import { getAllPageFolders } from '@/lib/repositories/pageFolderRepository';
import { getAllCollections } from '@/lib/repositories/collectionRepository';
import { getFieldsByCollectionId } from '@/lib/repositories/collectionFieldRepository';
import { getAllColorVariables } from '@/lib/repositories/colorVariableRepository';
import { getAllFonts } from '@/lib/repositories/fontRepository';
import { getAllLocales } from '@/lib/repositories/localeRepository';
import { resolveStudioProjectId } from '@/lib/project-scope';
import type { McpProjectContext } from '@/lib/mcp/project-context';

async function resolveMcpResourceProjectId(context: McpProjectContext): Promise<string | null> {
  if (context.projectId) return context.projectId;
  const projectLookup = process.env.STUDIO_MCP_PROJECT || process.env.STUDIO_PROJECT;
  return projectLookup ? resolveStudioProjectId(projectLookup) : null;
}

export function registerSiteResources(server: McpServer, projectContext: McpProjectContext = {}) {
  server.resource(
    'site-pages',
    'ycode://site/pages',
    {
      description: 'Current site structure — all pages with IDs, names, slugs, and folder hierarchy',
      mimeType: 'application/json',
    },
    async () => {
      const projectId = await resolveMcpResourceProjectId(projectContext);
      const [pages, folders] = await Promise.all([
        getAllPages(undefined, projectId),
        getAllPageFolders(undefined, projectId),
      ]);

      return {
        contents: [{
          uri: 'ycode://site/pages',
          mimeType: 'application/json',
          text: JSON.stringify({
            pages: pages.map((p) => ({
              id: p.id,
              name: p.name,
              slug: p.slug,
              is_index: p.is_index,
              is_dynamic: p.is_dynamic,
              folder_id: p.page_folder_id,
            })),
            folders: folders.map((f) => ({
              id: f.id,
              name: f.name,
              parent_id: f.page_folder_id,
            })),
          }),
        }],
      };
    },
  );

  server.resource(
    'site-collections',
    'ycode://site/collections',
    {
      description: 'Current CMS schema — all collections with their field definitions',
      mimeType: 'application/json',
    },
    async () => {
      const collections = await getAllCollections();

      const schema = await Promise.all(
        collections.map(async (c) => {
          const fields = await getFieldsByCollectionId(c.id);
          return {
            id: c.id,
            name: c.name,
            uuid: c.uuid,
            fields: fields.map((f) => ({
              id: f.id,
              name: f.name,
              key: f.key,
              type: f.type,
              reference_collection_id: f.reference_collection_id,
            })),
          };
        }),
      );

      return {
        contents: [{
          uri: 'ycode://site/collections',
          mimeType: 'application/json',
          text: JSON.stringify(schema),
        }],
      };
    },
  );

  server.resource(
    'site-design-tokens',
    'ycode://site/design-tokens',
    {
      description: 'Current design tokens — color variables, fonts, and locales configured for the site',
      mimeType: 'application/json',
    },
    async () => {
      const projectId = await resolveMcpResourceProjectId(projectContext);
      const [colorVariables, fonts, locales] = await Promise.all([
        getAllColorVariables(projectId).catch(() => []),
        getAllFonts(projectId).catch(() => []),
        getAllLocales(false, projectId).catch(() => []),
      ]);

      return {
        contents: [{
          uri: 'ycode://site/design-tokens',
          mimeType: 'application/json',
          text: JSON.stringify({
            color_variables: colorVariables.map((v) => ({
              id: v.id,
              name: v.name,
              value: v.value,
              usage: `var(--${v.id})`,
            })),
            fonts: fonts.map((f) => ({
              id: f.id,
              family: f.family,
              type: f.type,
              category: f.category,
              weights: f.weights,
            })),
            locales: locales.map((l) => ({
              id: l.id,
              code: l.code,
              label: l.label,
              is_default: l.is_default,
            })),
          }),
        }],
      };
    },
  );
}
