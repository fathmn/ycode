import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getUnpublishedPages } from '@/lib/repositories/pageRepository';
import {
  getStudioCustomCodeStateForProject,
  getStudioPreviewStateForProject,
  getStudioPreviewUrlPath,
  getStudioPublishReadiness,
  recordStudioPreviewApprovalForContext,
  resolveStudioMcpContext,
  StudioPreviewApprovalError,
  type StudioProjectContext,
  verifyStudioPublishGateForContext,
  writeStudioAuditLogForContext,
} from '@/lib/studio-platform';
import { executeStudioPublish } from '@/lib/studio-publish-service';
import { resolveMcpProjectId, type McpProjectContext } from '@/lib/mcp/project-context';

const projectSchema = z.string().optional().describe(
  'Optionaler Studio-Projekt-Slug. Muss dem Projekt des MCP-Tokens entsprechen.'
);

function jsonResult(payload: Record<string, unknown>, isError = false) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
}

function absoluteStudioUrl(path: string): { url: string; absolute: boolean } {
  const configuredHost = process.env.STUDIO_APP_HOST?.trim();
  if (!configuredHost) return { url: path, absolute: false };

  const baseUrl = /^https?:\/\//i.test(configuredHost)
    ? configuredHost
    : `https://${configuredHost}`;
  try {
    return { url: new URL(path, baseUrl).toString(), absolute: true };
  } catch {
    return { url: path, absolute: false };
  }
}

async function resolveTokenProject(
  projectContext: McpProjectContext,
  project?: string
): Promise<string> {
  const projectId = await resolveMcpProjectId(projectContext, project);
  if (!projectId) {
    throw new Error('Der MCP-Token ist keinem Studio-Projekt zugeordnet.');
  }
  return projectId;
}

function germanPublishBlocker(code: string, fallback: string): string {
  switch (code) {
    case 'STUDIO_PREVIEW_REQUIRED':
      return 'Für den aktuellen Entwurf fehlt die Vorschau-Freigabe. Öffnen Sie zuerst den Preview-Link im eingeloggten Browser, warten Sie kurz und rufen Sie danach approve_preview auf.';
    case 'STUDIO_CUSTOM_CODE_SECRET_BLOCKED':
      return 'Die Live-Schaltung ist blockiert, weil der Custom Code mögliche Secrets enthält. Entfernen Sie die Fundstellen, öffnen und prüfen Sie die Vorschau erneut und geben Sie sie danach wieder frei.';
    case 'STUDIO_PROJECT_SCOPED_PUBLISH_REQUIRED':
      return fallback || 'Die projektgebundene Live-Schaltung ist für diese Studio-Instanz noch nicht freigeschaltet.';
    case 'STUDIO_PUBLISH_ROLE_REQUIRED':
      return fallback || 'Der mit diesem MCP-Token verbundene Benutzer darf nicht veröffentlichen.';
    default:
      return fallback || 'Die Live-Schaltung ist durch das Studio-Sicherheits-Gate blockiert.';
  }
}

export async function publishStudioContextFromMcp(context: StudioProjectContext): Promise<Record<string, unknown>> {
  const gate = await verifyStudioPublishGateForContext(context, { source: 'mcp' });
  if (!gate.ok) {
    return {
      success: false,
      blocked: true,
      code: gate.code,
      message: germanPublishBlocker(gate.code, gate.message),
    };
  }

  try {
    await writeStudioAuditLogForContext({
      context: gate.context,
      action: 'site.publish.requested',
      entityType: 'site',
      entityId: gate.context.project.slug,
      metadata: {
        draftHash: gate.draftHash,
        actorRole: gate.context.role,
        customCode: gate.customCode,
      },
      required: true,
    });
  } catch {
    throw new Error('Die Live-Schaltung wurde abgebrochen, weil der verpflichtende Audit-Eintrag nicht gespeichert werden konnte.');
  }

  const result = await executeStudioPublish({
    context: gate.context,
    options: { publishAll: true },
  });
  return {
    success: true,
    changes: result.changes,
    published_at: result.published_at_setting.value,
    deployment: result.deployment,
  };
}

export function registerPublishingTools(server: McpServer, projectContext: McpProjectContext = {}) {
  server.tool(
    'get_publish_status',
    'Zeigt Entwurfs-, Vorschau- und Publish-Status für das fest an den MCP-Token gebundene Studio-Projekt.',
    { project: projectSchema },
    async ({ project }) => {
      try {
        const projectId = await resolveTokenProject(projectContext, project);
        const context = await resolveStudioMcpContext({
          projectId,
          actorUserId: projectContext.actorUserId,
          tokenId: projectContext.tokenId,
        });
        const [pages, previewState, customCode] = await Promise.all([
          getUnpublishedPages(projectId),
          getStudioPreviewStateForProject(context.client, projectId),
          getStudioCustomCodeStateForProject(context.client, projectId),
        ]);
        const readiness = getStudioPublishReadiness();
        const customCodeBlocked = customCode.secret_scan_status === 'blocked';
        const livePublishAvailable = readiness.livePublishAvailable
          && previewState.previewApproved
          && !customCodeBlocked;
        const blockerCode = !readiness.livePublishAvailable
          ? readiness.blockerCode
          : !previewState.previewApproved
            ? 'STUDIO_PREVIEW_REQUIRED'
            : customCodeBlocked
              ? 'STUDIO_CUSTOM_CODE_SECRET_BLOCKED'
              : null;
        const blockerMessage = !readiness.livePublishAvailable
          ? readiness.blockerMessage
          : !previewState.previewApproved
            ? 'Preview-Freigabe für den aktuellen Entwurf fehlt.'
            : customCodeBlocked
              ? 'Custom Code enthält mögliche Secrets.'
              : null;
        const previewUrl = absoluteStudioUrl(previewState.previewUrlPath);
        const nextStep = !readiness.livePublishAvailable
          ? germanPublishBlocker(blockerCode || '', blockerMessage || '')
          : !previewState.renderedPreviewAvailable && !previewState.previewApproved
            ? 'Öffnen Sie den Preview-Link im eingeloggten Studio-Browser und warten Sie kurz, bis der Render-Proof gespeichert wurde.'
            : !previewState.previewApproved
              ? 'Rufen Sie approve_preview auf, wenn die Vorschau geprüft und in Ordnung ist.'
              : customCodeBlocked
                ? germanPublishBlocker('STUDIO_CUSTOM_CODE_SECRET_BLOCKED', blockerMessage || '')
                : pages.length === 0
                  ? 'Es gibt keine unveröffentlichten Seiten. Prüfen Sie, ob andere Entwurfsänderungen vorliegen, bevor Sie publish aufrufen.'
                  : 'Die Vorschau ist freigegeben. Rufen Sie publish auf, um die Änderungen live zu schalten.';

        return jsonResult({
          draft_hash: previewState.draftHash,
          unpublished_pages: pages.map((page) => ({ id: page.id, name: page.name })),
          has_unpublished_changes: pages.length > 0,
          preview_url: previewUrl.url,
          preview_approved: previewState.previewApproved,
          preview_approved_at: previewState.approvedAt,
          rendered_preview_available: previewState.renderedPreviewAvailable,
          live_publish_available: livePublishAvailable,
          blocker_code: blockerCode,
          blocker_message: blockerMessage,
          next_step: nextStep,
        });
      } catch (error) {
        return jsonResult({
          success: false,
          message: error instanceof Error ? error.message : 'Publish-Status konnte nicht geladen werden.',
        }, true);
      }
    },
  );

  server.tool(
    'get_unpublished_changes',
    'Kompatibilitätsalias: zeigt unveröffentlichte Seiten im bisherigen Response-Format.',
    { project: projectSchema },
    async ({ project }) => {
      try {
        const projectId = await resolveTokenProject(projectContext, project);
        const pages = await getUnpublishedPages(projectId).catch(() => []);
        return jsonResult({
          has_unpublished_changes: pages.length > 0,
          unpublished_pages: pages.map((page) => ({ id: page.id, name: page.name })),
          disabled_unscoped_categories: [
            'collections',
            'components',
            'assets',
            'asset_folders',
            'color_variables',
            'fonts',
            'locales',
          ],
        });
      } catch (error) {
        return jsonResult({
          message: error instanceof Error ? error.message : 'Unveröffentlichte Änderungen konnten nicht geladen werden.',
        }, true);
      }
    },
  );

  server.tool(
    'get_preview_url',
    'Liefert den kanonischen Preview-Link für das an den MCP-Token gebundene Studio-Projekt.',
    { project: projectSchema },
    async ({ project }) => {
      try {
        const projectId = await resolveTokenProject(projectContext, project);
        const context = await resolveStudioMcpContext({
          projectId,
          actorUserId: projectContext.actorUserId,
          tokenId: projectContext.tokenId,
        });
        const previewState = await getStudioPreviewStateForProject(context.client, projectId);
        const previewUrl = absoluteStudioUrl(previewState.previewUrlPath);
        return jsonResult({
          preview_url: previewUrl.url,
          draft_hash: previewState.draftHash,
          preview_approved: previewState.previewApproved,
          hint: previewUrl.absolute
            ? 'Öffnen Sie diesen Link in einem Browser mit eingeloggter Studio-Session. Erst der vollständig gerenderte Browser-Aufruf ermöglicht danach approve_preview.'
            : 'STUDIO_APP_HOST fehlt. Öffnen Sie diesen Pfad auf dem Studio-Host in einem eingeloggten Browser. Erst der vollständig gerenderte Browser-Aufruf ermöglicht danach approve_preview.',
        });
      } catch (error) {
        return jsonResult({
          success: false,
          message: error instanceof Error ? error.message : 'Preview-Link konnte nicht ermittelt werden.',
        }, true);
      }
    },
  );

  server.tool(
    'approve_preview',
    'Gibt eine bereits im eingeloggten Browser gerenderte Vorschau für den aktuellen Draft-Hash frei. Erzeugt selbst niemals einen Render-Proof.',
    {
      preview_url: z.string().optional().describe('Optionaler Preview-Link; Standard ist der kanonische Projekt-Preview-Link.'),
      project: projectSchema,
    },
    async ({ preview_url, project }) => {
      try {
        const projectId = await resolveTokenProject(projectContext, project);
        const context = await resolveStudioMcpContext({
          projectId,
          actorUserId: projectContext.actorUserId,
          tokenId: projectContext.tokenId,
        });
        const result = await recordStudioPreviewApprovalForContext(
          context,
          preview_url || getStudioPreviewUrlPath(context.project)
        );
        return jsonResult({
          success: true,
          preview_approved: true,
          draft_hash: result.draftHash,
          approved_at: result.data.created_at,
          preview_url: absoluteStudioUrl(result.data.preview_url).url,
          message: 'Die Vorschau wurde für den aktuellen Entwurf freigegeben.',
        });
      } catch (error) {
        if (error instanceof StudioPreviewApprovalError) {
          const message = error.code === 'STUDIO_PREVIEW_RENDER_REQUIRED'
            ? 'Für den aktuellen Entwurf wurde noch kein gültiger Browser-Render-Proof gefunden. Öffnen Sie den Preview-Link im eingeloggten Studio-Browser, warten Sie kurz und versuchen Sie approve_preview erneut.'
            : error.message;
          return jsonResult({ success: false, code: error.code, message }, true);
        }
        return jsonResult({
          success: false,
          message: error instanceof Error ? error.message : 'Die Vorschau konnte nicht freigegeben werden.',
        }, true);
      }
    },
  );

  server.tool(
    'publish',
    'Schaltet alle Entwurfsänderungen live, nachdem exakt das bestehende Studio-Publish-Gate erfolgreich durchlaufen wurde.',
    { project: projectSchema },
    async ({ project }) => {
      try {
        const projectId = await resolveTokenProject(projectContext, project);
        const context = await resolveStudioMcpContext({
          projectId,
          actorUserId: projectContext.actorUserId,
          tokenId: projectContext.tokenId,
        });
        const result = await publishStudioContextFromMcp(context);
        return jsonResult(result, result.success !== true);
      } catch (error) {
        return jsonResult({
          success: false,
          message: error instanceof Error ? error.message : 'Die Live-Schaltung ist fehlgeschlagen.',
        }, true);
      }
    },
  );
}
