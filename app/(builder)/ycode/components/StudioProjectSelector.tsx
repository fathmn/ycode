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

const STORAGE_KEY = 'studio:selected-project-slug';
const LEGACY_STORAGE_KEY = 'novum:selected-project-slug';

type StudioProject = {
  id: string;
  slug: string;
  name: string;
  primary_domain: string | null;
  status: string;
  role: string;
};

function getStoredProjectSlug() {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(STORAGE_KEY) ?? window.localStorage.getItem(LEGACY_STORAGE_KEY);
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

      const storedSlug = getStoredProjectSlug();
      const hasStoredProject = response.data.some((project) => project.slug === storedSlug);

      if (!hasStoredProject && response.data.length > 0) {
        setSelectedStudioProjectSlug(response.data[0].slug);
        setSelectedSlug(response.data[0].slug);
        window.location.reload();
      }
    };

    loadProjects();

    return () => {
      isMounted = false;
    };
  }, []);

  const selectedProject = useMemo(() => {
    return projects.find((project) => project.slug === selectedSlug) || projects[0] || null;
  }, [projects, selectedSlug]);

  if (!selectedProject) return null;

  const handleSelect = (slug: string) => {
    if (slug === selectedProject.slug) return;
    setSelectedStudioProjectSlug(slug);
    setSelectedSlug(slug);
    window.location.reload();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="xs"
          variant="secondary"
          className="max-w-48 justify-start gap-1.5"
        >
          <span className="truncate">{selectedProject.name}</span>
          {projects.length > 1 && <Icon name="chevronDown" className="size-3" />}
        </Button>
      </DropdownMenuTrigger>
      {projects.length > 1 && (
        <DropdownMenuContent align="end" className="w-56">
          {projects.map((project) => (
            <DropdownMenuItem
              key={project.id}
              onClick={() => handleSelect(project.slug)}
              className="flex items-center justify-between gap-3"
            >
              <span className="truncate">{project.name}</span>
              {project.slug === selectedProject.slug && <Icon name="check" className="size-3" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      )}
    </DropdownMenu>
  );
}
