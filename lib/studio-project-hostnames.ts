type StudioProjectHostInput = {
  id?: string | null;
  slug?: string | null;
  primary_domain?: string | null;
  metadata?: Record<string, unknown> | null;
};

const METADATA_HOST_KEYS = [
  'productionUrl',
  'production_url',
  'vercelProductionUrl',
  'vercel_production_url',
  'primaryDomain',
  'primary_domain',
  'customDomain',
  'custom_domain',
  'publicDomain',
  'public_domain',
];

const METADATA_HOST_ARRAY_KEYS = [
  'domains',
  'hostnames',
  'productionDomains',
  'production_domains',
  'publicDomains',
  'public_domains',
];

export function hostnameFromProjectLookup(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    return new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function addHostname(aliases: Set<string>, value: unknown): void {
  if (typeof value !== 'string') return;
  const hostname = hostnameFromProjectLookup(value);
  if (hostname) aliases.add(hostname);
}

export function studioProjectHostAliases(project: StudioProjectHostInput): string[] {
  const aliases = new Set<string>();
  addHostname(aliases, project.primary_domain);

  const metadata = project.metadata && typeof project.metadata === 'object' ? project.metadata : {};
  for (const key of METADATA_HOST_KEYS) {
    addHostname(aliases, metadata[key]);
  }

  for (const key of METADATA_HOST_ARRAY_KEYS) {
    const values = metadata[key];
    if (!Array.isArray(values)) continue;
    for (const value of values) addHostname(aliases, value);
  }

  return Array.from(aliases);
}

export function findStudioProjectHostMatches<T extends StudioProjectHostInput>(
  projects: T[],
  value: string | null | undefined
): T[] {
  const hostname = hostnameFromProjectLookup(value);
  if (!hostname) return [];
  return projects.filter((project) => studioProjectHostAliases(project).includes(hostname));
}
