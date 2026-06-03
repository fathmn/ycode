import { type NextRequest } from 'next/server';
import { STUDIO_INTEGRATION_MANAGER_ROLES } from '@/lib/studio-roles';
import { requireStudioProjectRole } from '@/lib/studio-platform';

export function requireStudioIntegrationManager(request: NextRequest) {
  return requireStudioProjectRole(request, STUDIO_INTEGRATION_MANAGER_ROLES);
}
