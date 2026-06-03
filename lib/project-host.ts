function hostnameFromUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value.startsWith('http') ? value : `https://${value}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function hostnameFromHostHeader(value: string | null | undefined): string | null {
  const firstHost = (value || '').split(',')[0]?.trim();
  if (!firstHost) return null;

  try {
    return new URL(firstHost.includes('://') ? firstHost : `https://${firstHost}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isLocalHostname(hostname: string | null): boolean {
  return !hostname || hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
}

function studioHostnames(): Set<string> {
  return new Set(
    [
      'studio.novum-partners.de',
      hostnameFromUrl(process.env.STUDIO_APP_HOST),
      hostnameFromUrl(process.env.NEXT_PUBLIC_SITE_URL),
      ...(process.env.STUDIO_APP_HOSTS || '').split(',').map((value) => hostnameFromUrl(value.trim())),
    ].filter((value): value is string => Boolean(value))
  );
}

export function projectLookupFromHost(host: string | null | undefined): string | null {
  const hostname = hostnameFromHostHeader(host);
  if (isLocalHostname(hostname)) return null;
  if (!hostname) return null;

  return studioHostnames().has(hostname) ? null : hostname;
}

export function projectLookupFromRequestHosts(
  host: string | null | undefined,
  forwardedHost: string | null | undefined
): string | null {
  const hostLookup = projectLookupFromHost(host);
  if (hostLookup) return hostLookup;

  const hostname = hostnameFromHostHeader(host);
  if (isLocalHostname(hostname) || studioHostnames().has(hostname!)) {
    return projectLookupFromHost(forwardedHost);
  }

  return null;
}
