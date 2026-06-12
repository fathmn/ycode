'use client';

import dynamic from 'next/dynamic';
import { Suspense, useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import BuilderLoading from '@/components/BuilderLoading';
import { ycodePathnameFromStudioProjectPath } from '@/lib/studio-project-path';
import StudioAuthGate from './components/StudioAuthGate';
import {
  startLockExpirationCheck,
  stopLockExpirationCheck,
  startNotificationCleanup,
  stopNotificationCleanup,
} from '@/stores/useCollaborationPresenceStore';

const YCodeBuilder = dynamic(() => import('./components/YCodeBuilderMain'), {
  ssr: false,
  loading: () => <BuilderLoading message="Studio wird geladen..." />,
});

/**
 * YCode Editor Layout (Client Component)
 *
 * This layout wraps all /ycode routes and renders YCodeBuilder once.
 * By keeping YCodeBuilder at the layout level, it persists across route changes,
 * preventing remounts and avoiding duplicate API calls on navigation.
 *
 * Routes:
 * - /ycode - Base editor
 * - /ycode/pages/[id] - Page editing
 * - /ycode/layers/[id] - Layer editing
 * - /ycode/collections/[id] - Collection management
 * - /ycode/components/[id] - Component editing
 * - /ycode/settings - Settings pages
 * - /ycode/localization - Localization pages
 * - /ycode/profile - Profile pages
 *
 * Excluded routes:
 * - /ycode/preview - Preview routes are excluded and render independently
 *
 * YCodeBuilder uses useEditorUrl() to detect route changes and update
 * the UI accordingly without remounting.
 */

function YCodeLayoutInner({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const editorPathname = useMemo(() => ycodePathnameFromStudioProjectPath(pathname, {
    rootIsYcode: true,
    projectRootIsYcode: true,
  }), [pathname]);

  // Reap expired collaboration locks and stale notifications for the lifetime
  // of the editor session. Both stores are global, so a single mount here
  // covers every builder route.
  useEffect(() => {
    startLockExpirationCheck();
    startNotificationCleanup();
    return () => {
      stopLockExpirationCheck();
      stopNotificationCleanup();
    };
  }, []);

  // Exclude standalone routes from YCodeBuilder
  // These routes should render independently without the editor UI
  const prefixRoutes = ['/ycode/preview', '/ycode/devtools/', '/ycode/oauth/'];
  const exactRoutes = ['/ycode/welcome', '/ycode/accept-invite'];
  const isStandaloneRoute = Boolean(
    prefixRoutes.some(route => editorPathname.startsWith(route))
    || exactRoutes.includes(editorPathname)
  );

  const routeRendersChildren = useMemo(() => Boolean(
    editorPathname.startsWith('/ycode/settings')
    || editorPathname.startsWith('/ycode/localization')
    || editorPathname.startsWith('/ycode/profile')
    || editorPathname.startsWith('/ycode/forms')
    || editorPathname.startsWith('/ycode/integrations')
  ), [editorPathname]);

  if (isStandaloneRoute) {
    return <>{children}</>;
  }

  return (
    <StudioAuthGate>
      <YCodeBuilder>{routeRendersChildren ? children : undefined}</YCodeBuilder>
    </StudioAuthGate>
  );
}

// Client layout wrapped in Suspense to handle useSearchParams
// Required by Next.js 14+ to prevent static rendering bailout
export default function YCodeLayoutClient({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={null}>
      <YCodeLayoutInner>{children}</YCodeLayoutInner>
    </Suspense>
  );
}
