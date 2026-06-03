import { NextRequest } from 'next/server';
import { getUnpublishedComponents } from '@/lib/repositories/componentRepository';
import { noCache } from '@/lib/api-response';
import { requireStudioProjectRole, type StudioProjectRole } from '@/lib/studio-platform';

// Disable caching for this route
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const COMPONENT_UNPUBLISHED_ROLES: StudioProjectRole[] = [
  'studio_admin',
  'studio_developer',
  'customer_owner',
  'customer_editor',
  'customer_viewer',
];

/**
 * GET /ycode/api/components/unpublished
 * Get all unpublished components (never published or changed since last publish)
 */
export async function GET(request: NextRequest) {
  try {
    const roleCheck = await requireStudioProjectRole(request, COMPONENT_UNPUBLISHED_ROLES);
    if (!roleCheck.ok) return roleCheck.response;

    const components = await getUnpublishedComponents(roleCheck.context.project.id);
    
    return noCache({ data: components });
  } catch (error) {
    console.error('Error fetching unpublished components:', error);
    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to fetch unpublished components' },
      500
    );
  }
}
