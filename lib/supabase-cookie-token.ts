import type { NextRequest } from 'next/server';

function parseSupabaseCookieValue(value: string): unknown {
  const rawValue = decodeURIComponent(value);
  const jsonValue = rawValue.startsWith('base64-')
    ? Buffer.from(rawValue.slice('base64-'.length), 'base64url').toString('utf8')
    : rawValue;

  return JSON.parse(jsonValue);
}

function authCookieValues(request: NextRequest): string[] {
  const cookies = request.cookies.getAll();
  const values: string[] = [];
  const chunkGroups = new Map<string, Array<{ index: number; value: string }>>();

  for (const cookie of cookies) {
    if (!cookie.name.includes('auth-token')) continue;

    const chunkMatch = /^(.*auth-token)\.(\d+)$/.exec(cookie.name);
    if (chunkMatch) {
      const [, baseName, index] = chunkMatch;
      const group = chunkGroups.get(baseName) || [];
      group.push({ index: Number(index), value: cookie.value });
      chunkGroups.set(baseName, group);
      continue;
    }

    values.push(cookie.value);
  }

  for (const chunks of chunkGroups.values()) {
    const sorted = chunks.sort((a, b) => a.index - b.index);
    if (!sorted.every((chunk, index) => chunk.index === index)) continue;
    values.push(sorted.map((chunk) => chunk.value).join(''));
  }

  return values;
}

export function extractSupabaseAccessToken(request: NextRequest): string | null {
  const bearer = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (bearer) return bearer;

  for (const value of authCookieValues(request)) {
    try {
      const parsed = parseSupabaseCookieValue(value);
      if (Array.isArray(parsed) && typeof parsed[0] === 'string') return parsed[0];
      if (typeof (parsed as { access_token?: unknown })?.access_token === 'string') {
        return (parsed as { access_token: string }).access_token;
      }
      if (typeof (parsed as { currentSession?: { access_token?: unknown } })?.currentSession?.access_token === 'string') {
        return (parsed as { currentSession: { access_token: string } }).currentSession.access_token;
      }
    } catch {
      // Supabase cookie formats can differ between helper versions.
    }
  }

  return null;
}
