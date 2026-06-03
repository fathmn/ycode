import packageJson from '../../../../../../package.json';
import { noCache } from '@/lib/api-response';
import { checkForUpdates } from '@/lib/updates/check-updates';
import { requireStudioProjectRole } from '@/lib/studio-platform';
import type { NextRequest } from 'next/server';

// Disable caching for this route
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /ycode/api/updates/check
 *
 * Check for updates from the official Ycode repository
 */
export async function GET(request: NextRequest) {
  const roleCheck = await requireStudioProjectRole(request, ['studio_admin', 'studio_developer']);
  if (!roleCheck.ok) return roleCheck.response;

  const result = await checkForUpdates(packageJson.version);
  return noCache(result);
}
