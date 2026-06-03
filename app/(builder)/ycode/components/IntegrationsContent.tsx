'use client';

import React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { getSelectedStudioProjectSlug, studioProjectsApi } from '@/lib/api';
import { studioProjectPathFromSlug, studioProjectPathSlugFromPathname, studioProjectRoutePathFromSlug } from '@/lib/studio-project-path';
import { isStudioOperatorRole } from '@/lib/studio-roles';

const INTEGRATIONS_ITEMS = [
  { id: 'apps', label: 'Apps', path: '/ycode/integrations/apps' },
  { id: 'webhooks', label: 'Webhooks', path: '/ycode/integrations/webhooks' },
  { id: 'api', label: 'Studio API', path: '/ycode/integrations/api' },
  { id: 'mcp', label: 'MCP', path: '/ycode/integrations/mcp' },
];

interface IntegrationsContentProps {
  children: React.ReactNode;
}

export default function IntegrationsContent({ children }: IntegrationsContentProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [isAllowed, setIsAllowed] = useState(false);
  const [roleLoaded, setRoleLoaded] = useState(false);
  const [projectPathSlug, setProjectPathSlug] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    studioProjectsApi.getAssigned().then((response) => {
      if (!isMounted) return;
      if (response.error || !response.data) {
        setRoleLoaded(true);
        return;
      }

      const pathSlug = studioProjectPathSlugFromPathname(window.location.pathname);
      const pathProject = pathSlug
        ? response.data.find((project) => project.studio_path_slug === pathSlug)
        : null;
      const selectedSlug = getSelectedStudioProjectSlug();
      const selectedProject = pathProject
        || (selectedSlug ? response.data.find((project) => project.slug === selectedSlug) : null)
        || response.data[0];

      setProjectPathSlug(selectedProject?.studio_path_slug || null);
      setIsAllowed(isStudioOperatorRole(selectedProject?.role));
      setRoleLoaded(true);
    });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!roleLoaded || isAllowed) return;
    router.replace(studioProjectPathFromSlug(projectPathSlug));
  }, [isAllowed, projectPathSlug, roleLoaded, router]);

  const canRenderContent = useMemo(() => roleLoaded && isAllowed, [isAllowed, roleLoaded]);

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Left Sidebar */}
      <div className="w-60 border-r flex flex-col px-4">
        <header className="py-5 flex justify-between">
          <span className="font-medium">Integrations</span>
        </header>

        <div className="flex-1 overflow-y-auto">
          <div className="space-y-0">
            {INTEGRATIONS_ITEMS.map((item) => {
              const itemPath = studioProjectRoutePathFromSlug(projectPathSlug, item.path);
              const isActive = pathname === item.path || pathname === itemPath;

              return (
                <button
                  key={item.id}
                  onClick={() => router.push(itemPath)}
                  className={cn(
                    'group relative flex items-center h-8 outline-none focus:outline-none rounded-lg cursor-pointer select-none w-full text-left px-2 text-xs',
                    'hover:bg-secondary/50',
                    isActive && 'bg-primary text-primary-foreground hover:bg-primary',
                    !isActive && 'text-secondary-foreground/80 dark:text-muted-foreground'
                  )}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto">
        {canRenderContent ? children : null}
      </div>
    </div>
  );
}
