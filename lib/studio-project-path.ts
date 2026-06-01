type ProjectPathInput = {
  id?: string | null;
  slug?: string | null;
  metadata?: Record<string, unknown> | null;
};

const RESERVED_STUDIO_PATH_SLUGS = new Set([
  '_next',
  'a',
  'api',
  'canvas',
  'favicon',
  'icon',
  'llms',
  'robots',
  'sitemap',
  'ycode',
]);

export function normalizeStudioProjectPathSlug(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/^\/+|\/+$/g, '');
  if (!trimmed || trimmed.includes('/')) return null;
  if (!/^[a-z0-9][a-z0-9-]{0,126}[a-z0-9]$/i.test(trimmed)) return null;
  const normalized = trimmed.toLowerCase();
  if (RESERVED_STUDIO_PATH_SLUGS.has(normalized)) return null;
  return normalized;
}

export function studioProjectPathSlug(project: ProjectPathInput): string | null {
  const metadata = project.metadata && typeof project.metadata === 'object' ? project.metadata : {};
  const configured = normalizeStudioProjectPathSlug(
    metadata.studioPathSlug
      || metadata.studio_path_slug
      || metadata.studioSlug
      || metadata.studio_slug
      || metadata.publicSlug
      || metadata.public_slug
  );
  if (configured) return configured;

  const slug = normalizeStudioProjectPathSlug(project.slug);
  if (!slug) return null;
  if (!slug.endsWith('-studio')) return slug;
  return normalizeStudioProjectPathSlug(slug.slice(0, -'-studio'.length)) || slug;
}

export function studioProjectPathFromSlug(pathSlug: string | null | undefined): string {
  const normalized = normalizeStudioProjectPathSlug(pathSlug);
  return normalized ? `/${normalized}` : '/ycode';
}

export function studioProjectRoutePathFromSlug(
  pathSlug: string | null | undefined,
  routePath: string
): string {
  const normalizedRoute = routePath.startsWith('/') ? routePath : `/${routePath}`;
  const normalizedSlug = normalizeStudioProjectPathSlug(pathSlug);
  if (!normalizedSlug) {
    return normalizedRoute.startsWith('/ycode') ? normalizedRoute : `/ycode${normalizedRoute}`;
  }
  if (normalizedRoute === '/' || normalizedRoute === '/ycode') return `/${normalizedSlug}`;
  if (normalizedRoute.startsWith('/ycode/')) {
    return `/${normalizedSlug}${normalizedRoute.slice('/ycode'.length)}`;
  }
  return `/${normalizedSlug}${normalizedRoute}`;
}

export function studioProjectPathSlugFromPathname(pathname: string | null | undefined): string | null {
  if (!pathname) return null;
  const firstSegment = pathname.split('?')[0].split('#')[0].split('/').filter(Boolean)[0];
  return normalizeStudioProjectPathSlug(firstSegment);
}

export function findUniqueStudioProjectPathMatch<T extends ProjectPathInput>(
  projects: T[],
  value: string | null | undefined
): T | null {
  const matches = findStudioProjectPathMatches(projects, value);
  return matches.length === 1 ? matches[0] : null;
}

export function findStudioProjectPathMatches<T extends ProjectPathInput>(
  projects: T[],
  value: string | null | undefined
): T[] {
  const normalized = normalizeStudioProjectPathSlug(value);
  if (!normalized) return [];

  return projects.filter((project) => studioProjectPathSlug(project) === normalized);
}

export function findDuplicateStudioProjectPathSlugs(projects: ProjectPathInput[]): string[] {
  const counts = new Map<string, number>();
  for (const project of projects) {
    const pathSlug = studioProjectPathSlug(project);
    if (!pathSlug) continue;
    counts.set(pathSlug, (counts.get(pathSlug) || 0) + 1);
  }

  return Array.from(counts.entries())
    .filter(([, count]) => count > 1)
    .map(([pathSlug]) => pathSlug)
    .sort();
}
