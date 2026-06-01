'use client';

import React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { getSelectedStudioProjectSlug, studioProjectsApi } from '@/lib/api';
import { studioProjectRoutePathFromSlug } from '@/lib/studio-project-path';
import { SETTINGS_NAV_ITEMS, visibleSettingsNavItems } from '@/lib/settings-nav-items';

interface SettingsContentProps {
  children: React.ReactNode;
}

export default function SettingsContent({ children }: SettingsContentProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [roles, setRoles] = useState<string[]>([]);
  const [rolesLoaded, setRolesLoaded] = useState(false);
  const [projectPathSlug, setProjectPathSlug] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    studioProjectsApi.getAssigned().then((response) => {
      if (!isMounted) return;
      if (response.error || !response.data) {
        setRolesLoaded(true);
        return;
      }
      const selectedSlug = getSelectedStudioProjectSlug();
      const selectedProject = selectedSlug
        ? response.data.find((project) => project.slug === selectedSlug) || response.data[0]
        : response.data[0];
      setRoles(response.data.map((project) => project.role));
      setProjectPathSlug(selectedProject?.studio_path_slug || null);
      setRolesLoaded(true);
    });

    return () => {
      isMounted = false;
    };
  }, []);

  const navItems = useMemo(() => (
    rolesLoaded ? visibleSettingsNavItems(roles) : SETTINGS_NAV_ITEMS
  ), [roles, rolesLoaded]);

  useEffect(() => {
    if (!rolesLoaded || navItems.length === 0) return;
    const currentItem = navItems.find((item) => pathname === item.path || pathname === studioProjectRoutePathFromSlug(projectPathSlug, item.path));
    if (!currentItem && pathname?.includes('/settings/')) {
      router.replace(studioProjectRoutePathFromSlug(projectPathSlug, navItems[0].path));
    }
  }, [navItems, pathname, projectPathSlug, rolesLoaded, router]);

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Left Sidebar */}
      <div className="w-60 border-r flex flex-col px-4">
        <header className="py-5 flex justify-between">
          <span className="font-medium">Einstellungen</span>
        </header>

        <div className="flex-1 overflow-y-auto">
          <div className="space-y-0">
            {navItems.map((item) => {
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
        {children}
      </div>
    </div>
  );
}
