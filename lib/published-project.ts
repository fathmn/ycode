import { headers } from 'next/headers';
import {
  resolveCurrentYcodeSiteProjectId,
  resolveStudioProjectId,
} from '@/lib/project-scope';
import { projectLookupFromRequestHosts } from '@/lib/project-host';

export interface PublishedProjectResolution {
  projectId: string | null;
  unresolvedHost: boolean;
}

export async function resolvePublishedProjectFromHeaders(): Promise<PublishedProjectResolution> {
  const requestHeaders = await headers();
  const hostLookup = projectLookupFromRequestHosts(
    requestHeaders.get('host'),
    requestHeaders.get('x-forwarded-host')
  );

  if (hostLookup) {
    const projectId = await resolveStudioProjectId(hostLookup);
    return { projectId, unresolvedHost: !projectId };
  }

  return {
    projectId: await resolveCurrentYcodeSiteProjectId(),
    unresolvedHost: false,
  };
}
