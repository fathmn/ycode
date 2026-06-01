import type { Session, SupabaseClient, User } from '@supabase/supabase-js';

export type SupabaseEmailAuthFlow = 'invite' | 'magiclink' | 'recovery';

type ApplyEmailAuthUrlSessionResult = {
  error: string | null;
  flow: SupabaseEmailAuthFlow | null;
  session: Session | null;
  sessionApplied: boolean;
  user: User | null;
};

function supportedFlow(value: string | null): SupabaseEmailAuthFlow | null {
  if (value === 'invite' || value === 'magiclink' || value === 'recovery') {
    return value;
  }
  return null;
}

export function resolveSupabaseEmailAuthFlow(defaultCodeFlow?: SupabaseEmailAuthFlow | null): SupabaseEmailAuthFlow | null {
  if (typeof window === 'undefined') return null;

  const hash = window.location.hash.replace(/^#/, '');
  if (hash) {
    const hashParams = new URLSearchParams(hash);
    const hashFlow = supportedFlow(hashParams.get('type'));
    if (hashFlow) return hashFlow;
  }

  const searchParams = new URLSearchParams(window.location.search);
  const queryFlow = supportedFlow(searchParams.get('auth_flow')) || supportedFlow(searchParams.get('type'));
  if (queryFlow) return queryFlow;

  if (searchParams.has('code')) {
    if (defaultCodeFlow) return defaultCodeFlow;
    if (window.location.pathname === '/ycode') return 'recovery';
    if (window.location.pathname === '/ycode/accept-invite') return 'invite';
  }

  return null;
}

function readAuthCode(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('code');
}

function readHashSessionParams(): { accessToken: string; refreshToken: string } | null {
  if (typeof window === 'undefined') return null;

  const hash = window.location.hash.replace(/^#/, '');
  if (!hash) return null;

  const params = new URLSearchParams(hash);
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (!accessToken || !refreshToken) return null;

  return { accessToken, refreshToken };
}

function readHashAuthError(): string | null {
  if (typeof window === 'undefined') return null;

  const hash = window.location.hash.replace(/^#/, '');
  if (!hash) return null;

  const params = new URLSearchParams(hash);
  const errorDescription = params.get('error_description');
  const errorCode = params.get('error_code');
  const error = params.get('error');

  return errorDescription || errorCode || error;
}

export function cleanSupabaseEmailAuthUrl(): void {
  if (typeof window === 'undefined') return;

  const params = new URLSearchParams(window.location.search);
  params.delete('code');
  params.delete('auth_flow');
  params.delete('type');

  const query = params.toString();
  const cleanUrl = `${window.location.pathname}${query ? `?${query}` : ''}`;
  window.history.replaceState(null, '', cleanUrl);
}

export async function applySupabaseEmailAuthUrlSession(
  supabase: SupabaseClient,
  options: { defaultCodeFlow?: SupabaseEmailAuthFlow | null } = {}
): Promise<ApplyEmailAuthUrlSessionResult> {
  const flow = resolveSupabaseEmailAuthFlow(options.defaultCodeFlow);
  const code = readAuthCode();
  const hashSession = readHashSessionParams();
  const hashError = readHashAuthError();

  if (hashError) {
    cleanSupabaseEmailAuthUrl();
    return {
      error: hashError,
      flow,
      session: null,
      sessionApplied: false,
      user: null,
    };
  }

  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    cleanSupabaseEmailAuthUrl();

    return {
      error: error?.message || null,
      flow,
      session: data.session || null,
      sessionApplied: !error && Boolean(data.session),
      user: data.user || null,
    };
  }

  if (hashSession) {
    const { data, error } = await supabase.auth.setSession({
      access_token: hashSession.accessToken,
      refresh_token: hashSession.refreshToken,
    });
    cleanSupabaseEmailAuthUrl();

    return {
      error: error?.message || null,
      flow,
      session: data.session || null,
      sessionApplied: !error && Boolean(data.session),
      user: data.user || null,
    };
  }

  return {
    error: null,
    flow,
    session: null,
    sessionApplied: false,
    user: null,
  };
}
