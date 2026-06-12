import { NextRequest, NextResponse } from 'next/server';
import { createRouteClient } from '@/lib/supabase-route-client';

/**
 * GET /ycode/api/auth/callback
 *
 * Handle OAuth callback from Supabase Auth
 */
export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const requestedFlow = requestUrl.searchParams.get('auth_flow') || requestUrl.searchParams.get('type');
  const authFlow = requestedFlow === 'invite' || requestedFlow === 'magiclink' || requestedFlow === 'recovery'
    ? requestedFlow
    : null;

  if (code) {
    try {
      const supabase = await createRouteClient();

      if (!supabase) {
        return NextResponse.redirect(
          new URL('/ycode?auth_error=config', request.url)
        );
      }

      const { error } = await supabase.auth.exchangeCodeForSession(code);

      if (error) {
        console.error('Auth callback error:', error);
        return NextResponse.redirect(
          new URL('/ycode?auth_error=auth', request.url)
        );
      }

      const redirectUrl = new URL('/ycode', request.url);
      if (authFlow) {
        redirectUrl.searchParams.set('auth_flow', authFlow);
      }
      return NextResponse.redirect(redirectUrl);
    } catch (error) {
      console.error('Auth callback failed:', error);
      return NextResponse.redirect(
        new URL('/ycode?auth_error=server', request.url)
      );
    }
  }

  // No code provided - return to the Studio auth surface.
  return NextResponse.redirect(new URL('/ycode', request.url));
}
