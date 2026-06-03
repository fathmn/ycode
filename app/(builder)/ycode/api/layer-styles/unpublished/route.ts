import { NextRequest } from 'next/server';
import { getUnpublishedLayerStyles } from '@/lib/repositories/layerStyleRepository';
import { noCache } from '@/lib/api-response';
import { requireStudioProjectRole, type StudioProjectRole } from '@/lib/studio-platform';

// Disable caching for this route
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const LAYER_STYLE_UNPUBLISHED_ROLES: StudioProjectRole[] = [
  'studio_admin',
  'studio_developer',
  'customer_owner',
  'customer_editor',
  'customer_viewer',
];

/**
 * GET /ycode/api/layer-styles/unpublished
 * Get all unpublished layer styles (never published or changed since last publish)
 */
export async function GET(request: NextRequest) {
  try {
    const roleCheck = await requireStudioProjectRole(request, LAYER_STYLE_UNPUBLISHED_ROLES);
    if (!roleCheck.ok) return roleCheck.response;

    const styles = await getUnpublishedLayerStyles(roleCheck.context.project.id);
    
    return noCache({ data: styles });
  } catch (error) {
    console.error('Error fetching unpublished layer styles:', error);
    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to fetch unpublished layer styles' },
      500
    );
  }
}
