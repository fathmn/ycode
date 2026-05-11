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

export function projectLookupFromHost(host: string | null | undefined): string | null {
  const hostname = hostnameFromHostHeader(host);
  if (!hostname || hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]') return null;

  const studioHosts = new Set(
    [
      'studio.novum-partners.de',
      hostnameFromUrl(process.env.NEXT_PUBLIC_SITE_URL),
      hostnameFromUrl(process.env.VERCEL_PROJECT_PRODUCTION_URL),
      hostnameFromUrl(process.env.VERCEL_URL),
      ...(process.env.STUDIO_APP_HOSTS || '').split(',').map((value) => hostnameFromUrl(value.trim())),
    ].filter((value): value is string => Boolean(value))
  );

  return studioHosts.has(hostname) ? null : hostname;
}
