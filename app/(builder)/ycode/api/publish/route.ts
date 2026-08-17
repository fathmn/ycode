import { NextRequest } from 'next/server';
import { noCache } from '@/lib/api-response';
import {
  executeStudioPublish,
  type PublishRequest,
} from '@/lib/studio-publish-service';
import { verifyStudioPublishGate } from '@/lib/studio-platform';

// Disable caching for this route
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * POST /ycode/api/publish
 *
 * Global publish endpoint that can:
 * 1. Publish all unpublished items (publishAll: true)
 * 2. Publish specific selected items (provide IDs)
 */
export async function POST(request: NextRequest) {
  try {
    const body: PublishRequest = await request.json().catch(() => ({}));
    const studioGate = await verifyStudioPublishGate(request);
    if (!studioGate.ok) return studioGate.response;

    const result = await executeStudioPublish({
      context: studioGate.context,
      options: body,
    });
    const totalPublished =
      result.changes.folders
      + result.changes.pages
      + result.changes.collectionItems
      + result.changes.components
      + result.changes.layerStyles
      + result.changes.assetFolders
      + result.changes.assets
      + result.changes.locales
      + result.changes.translations;

    return noCache({
      data: result,
      message: result.deployment.triggered
        ? `Published a total of ${totalPublished} item(s) successfully and triggered deployment`
        : `Published a total of ${totalPublished} item(s) successfully`,
    });
  } catch (error) {
    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to publish' },
      500
    );
  }
}
