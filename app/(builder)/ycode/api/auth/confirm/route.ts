import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import type { EmailOtpType } from '@supabase/supabase-js';
import { credentials } from '@/lib/credentials';
import { STUDIO_BASE_PATH } from '@/lib/brand';
import { parseSupabaseConfig } from '@/lib/supabase-config-parser';
import type { SupabaseConfig } from '@/types';

const SUPPORTED_EMAIL_OTP_TYPES = new Set<EmailOtpType>([
  'email',
  'signup',
  'invite',
  'magiclink',
  'recovery',
  'email_change',
]);

function readEmailOtpType(value: string | null): EmailOtpType | null {
  if (!value) return null;
  return SUPPORTED_EMAIL_OTP_TYPES.has(value as EmailOtpType) ? value as EmailOtpType : null;
}

function resolveRedirectUrl(request: NextRequest, type: EmailOtpType): URL {
  const requestUrl = new URL(request.url);
  const rawRedirect = requestUrl.searchParams.get('redirect_to');
  const fallback = new URL(STUDIO_BASE_PATH, request.url);

  let redirectUrl: URL;
  try {
    redirectUrl = rawRedirect
      ? new URL(rawRedirect, request.url)
      : fallback;
  } catch {
    redirectUrl = fallback;
  }

  if (redirectUrl.origin !== requestUrl.origin) {
    redirectUrl = fallback;
  }

  if ((type === 'invite' || type === 'recovery') && !redirectUrl.searchParams.has('auth_flow')) {
    redirectUrl.searchParams.set('auth_flow', type);
  }

  return redirectUrl;
}

function authErrorRedirect(request: NextRequest, error: string, type?: EmailOtpType | null): NextResponse {
  const redirectUrl = new URL(STUDIO_BASE_PATH, request.url);
  redirectUrl.searchParams.set('auth_error', error);
  if (type === 'invite' || type === 'recovery') {
    redirectUrl.searchParams.set('auth_flow', type);
  }
  return NextResponse.redirect(redirectUrl);
}

/**
 * GET /ycode/api/auth/confirm
 *
 * Server-side endpoint for Supabase email templates that use TokenHash.
 * This avoids relying on the initiating browser's PKCE verifier storage when
 * a recovery or invite link is opened from email.
 */
export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const tokenHash = requestUrl.searchParams.get('token_hash');
  const type = readEmailOtpType(requestUrl.searchParams.get('type'));

  if (!tokenHash || !type) {
    return authErrorRedirect(request, 'invalid_link', type);
  }

  try {
    const config = await credentials.get<SupabaseConfig>('supabase_config');
    if (!config) {
      return authErrorRedirect(request, 'config', type);
    }

    const parsed = parseSupabaseConfig(config);
    const response = NextResponse.redirect(resolveRedirectUrl(request, type));
    const supabase = createServerClient(
      parsed.projectUrl,
      parsed.anonKey,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) => {
              response.cookies.set(name, value, options);
            });
          },
        },
      }
    );

    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type,
    });

    if (error) {
      console.error('[auth/confirm] Email OTP verification failed:', error);
      return authErrorRedirect(request, 'auth', type);
    }

    return response;
  } catch (error) {
    console.error('[auth/confirm] Unexpected error:', error);
    return authErrorRedirect(request, 'server', type);
  }
}
