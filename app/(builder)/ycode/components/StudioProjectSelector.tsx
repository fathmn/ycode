'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import Icon from '@/components/ui/icon';
import { setSelectedStudioProjectSlug, studioProjectsApi } from '@/lib/api';
import { findUniqueStudioProjectPathMatch, studioProjectPathFromSlug, studioProjectPathSlugFromPathname } from '@/lib/studio-project-path';
import { isStudioOperatorRole } from '@/lib/studio-roles';

const STORAGE_KEY = 'studio:selected-project-slug';
const LEGACY_STORAGE_KEY = 'novum:selected-project-slug';

type StudioProject = {
  id: string;
  slug: string;
  studio_path_slug: string | null;
  studio_path: string | null;
  name: string;
  primary_domain: string | null;
  status: string;
  role: string;
};

function hasSiteAdminProjectRole(projects: StudioProject[]) {
  return projects.some((project) => isStudioOperatorRole(project.role));
}

function getStoredProjectSlug() {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(STORAGE_KEY) ?? window.localStorage.getItem(LEGACY_STORAGE_KEY);
}

function findProjectForCurrentPath(projects: StudioProject[]): StudioProject | null {
  if (typeof window === 'undefined') return null;
  const pathSlug = studioProjectPathSlugFromPathname(window.location.pathname);
  if (!pathSlug) return null;
  return findUniqueStudioProjectPathMatch(projects, pathSlug);
}

export default function StudioProjectSelector() {
  const [projects, setProjects] = useState<StudioProject[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(() => getStoredProjectSlug());

  useEffect(() => {
    let isMounted = true;

    const loadProjects = async () => {
      const response = await studioProjectsApi.getAssigned();
      if (!isMounted || response.error || !response.data) return;

      setProjects(response.data);

      const pathProject = findProjectForCurrentPath(response.data);
      if (pathProject) {
        setSelectedStudioProjectSlug(pathProject.slug);
        setSelectedSlug(pathProject.slug);
        return;
      }

      const storedSlug = getStoredProjectSlug();
      const hasStoredProject = response.data.some((project) => project.slug === storedSlug);
      const isSiteAdmin = hasSiteAdminProjectRole(response.data);

      if (!hasStoredProject && response.data.length > 0 && !isSiteAdmin) {
        setSelectedStudioProjectSlug(response.data[0].slug);
        setSelectedSlug(response.data[0].slug);
      }
    };

    loadProjects();

    return () => {
      isMounted = false;
    };
  }, []);

  const selectedProject = useMemo(() => {
    return projects.find((project) => project.slug === selectedSlug) || null;
  }, [projects, selectedSlug]);

  if (projects.length === 0) return null;
  if (projects.length === 1 && selectedProject && !hasSiteAdminProjectRole(projects)) {
    return (
      <div className="max-w-48 truncate rounded-md bg-secondary px-3 py-1.5 text-xs text-secondary-foreground">
        {selectedProject.name}
      </div>
    );
  }

  const handleSelect = (project: StudioProject) => {
    if (!project.studio_path_slug) return;
    if (project.slug === selectedProject?.slug) return;
    setSelectedStudioProjectSlug(project.slug);
    setSelectedSlug(project.slug);
    window.location.assign(studioProjectPathFromSlug(project.studio_path_slug));
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="xs"
          variant="secondary"
          className="max-w-48 justify-start gap-1.5"
        >
          <span className="truncate">{selectedProject?.name || 'Projekt wählen'}</span>
          <Icon name="chevronDown" className="size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {projects.map((project) => (
          <DropdownMenuItem
            key={project.id}
            onClick={() => handleSelect(project)}
            disabled={!project.studio_path_slug}
            className="flex items-center justify-between gap-3"
          >
            <span className="truncate">{project.name}</span>
            {project.slug === selectedProject?.slug && <Icon name="check" className="size-3" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
