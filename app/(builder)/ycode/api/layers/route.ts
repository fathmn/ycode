import { NextRequest, NextResponse } from 'next/server';
import { getLayersByPageId, upsertDraftLayers } from '@/lib/repositories/pageLayersRepository';
import { noCache } from '@/lib/api-response';
import { recordStudioCustomCodeMutation, requireStudioProjectRole, type StudioProjectRole } from '@/lib/studio-platform';
import type { Layer } from '@/types';

// Disable caching for this route
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const LAYER_READ_ROLES: StudioProjectRole[] = [
  'studio_admin',
  'studio_developer',
  'customer_owner',
  'customer_editor',
  'customer_viewer',
];
const LAYER_WRITE_ROLES: StudioProjectRole[] = [
  'studio_admin',
  'studio_developer',
  'customer_owner',
  'customer_editor',
];

/**
 * GET /ycode/api/layers?page_id=X&is_published=false
 *
 * Get layers for a page with optional is_published filter
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const pageId = searchParams.get('page_id');
    const isPublishedParam = searchParams.get('is_published');

    if (!pageId) {
      return noCache(
        { error: 'page_id query parameter is required' },
        400
      );
    }

    // Parse is_published filter
    const isPublished = isPublishedParam === 'true' ? true : isPublishedParam === 'false' ? false : undefined;

    const roleCheck = await requireStudioProjectRole(request, LAYER_READ_ROLES);
    if (!roleCheck.ok) return roleCheck.response;

    const layers = await getLayersByPageId(pageId, isPublished, roleCheck.context.project.id);

    if (!layers) {
      return noCache(
        { error: 'Layers not found' },
        404
      );
    }

    return noCache({
      data: layers,
    });
  } catch (error) {
    console.error('Failed to fetch layers:', error);

    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to fetch layers' },
      500
    );
  }
}

/**
 * PUT /ycode/api/layers?page_id=X
 *
 * Update draft layers for a page
 */
export async function PUT(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const pageId = searchParams.get('page_id');

    if (!pageId) {
      return noCache(
        { error: 'page_id query parameter is required' },
        400
      );
    }

    const body = await request.json();
    const { layers } = body;

    if (!Array.isArray(layers)) {
      return noCache(
        { error: 'Invalid layers data' },
        400
      );
    }

    const roleCheck = await requireStudioProjectRole(request, LAYER_WRITE_ROLES);
    if (!roleCheck.ok) return roleCheck.response;

    const draft = await upsertDraftLayers(pageId, layers as Layer[], undefined, undefined, roleCheck.context.project.id);
    const htmlEmbedCode = collectHtmlEmbedCode(layers as Layer[]);

    if (htmlEmbedCode.length > 0) {
      await recordStudioCustomCodeMutation(request, {
        scope: 'embed',
        targetId: pageId,
        content: htmlEmbedCode.join('\n---\n'),
        metadata: {
          route: '/ycode/api/layers',
          pageId,
          snippets: htmlEmbedCode.length,
        },
      });
    }

    return noCache({
      data: draft,
    });
  } catch (error) {
    console.error('Failed to update layers:', error);

    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to update layers' },
      500
    );
  }
}

function collectHtmlEmbedCode(layers: Layer[]): string[] {
  const snippets: string[] = [];

  const walk = (layer: Layer) => {
    const code = layer.name === 'htmlEmbed' ? layer.settings?.htmlEmbed?.code : null;
    if (typeof code === 'string' && code.trim()) {
      snippets.push(code);
    }

    for (const child of layer.children || []) {
      walk(child as Layer);
    }
  };

  for (const layer of layers) {
    walk(layer);
  }

  return snippets;
}
