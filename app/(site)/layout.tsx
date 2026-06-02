import '@/app/globals.css';
import { headers } from 'next/headers';
import RootLayoutShell, { defaultMetadata } from '@/components/RootLayoutShell';
import { fetchGlobalPageSettings } from '@/lib/generate-page-metadata';
import { projectLookupFromHost, resolveStudioProjectId } from '@/lib/project-scope';
import { renderRootLayoutHeadCode } from '@/lib/parse-head-html';

export const metadata = defaultMetadata;

async function resolvePublishedProjectId(): Promise<string | null> {
  const requestHeaders = await headers();
  const hostLookup = projectLookupFromHost(
    requestHeaders.get('host') || requestHeaders.get('x-forwarded-host')
  );
  return hostLookup ? resolveStudioProjectId(hostLookup) : null;
}

export default async function SiteLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  let headElements: React.ReactNode[] = [];

  // Cloud mode uses ISR with explicit tenantId — calling headers() here
  // would force all pages dynamic. Cloud injects global head code from PageRenderer instead.
  if (process.env.SKIP_SETUP !== 'true') {
    try {
      const projectId = await resolvePublishedProjectId();
      const globalSettings = await fetchGlobalPageSettings(projectId);
      if (globalSettings.globalCustomCodeHead) {
        headElements = renderRootLayoutHeadCode(globalSettings.globalCustomCodeHead);
      }
    } catch {
      // Supabase not configured — skip custom code
    }
  }

  return (
    <RootLayoutShell headElements={headElements}>
      {children}
    </RootLayoutShell>
  );
}
