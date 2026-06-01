import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { CookieOptions } from '@supabase/ssr';
import { credentials } from '@/lib/credentials';
import { cookies } from 'next/headers';

/**
 * GET /ycode/api/auth/callback
 * 
 * Handle OAuth callback from Supabase Auth
 * (For future OAuth implementation)
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
      // Get Supabase config
      const config = await credentials.get<{
        url: string;
        anonKey: string;
        serviceRoleKey: string;
      }>('supabase_config');

      if (!config) {
        return NextResponse.redirect(
          new URL('/ycode?auth_error=config', request.url)
        );
      }

      const cookieStore = await cookies();

      // Create Supabase client
      const supabase = createServerClient(
        config.url,
        config.anonKey,
        {
          cookies: {
            get(name: string) {
              return cookieStore.get(name)?.value;
            },
            set(name: string, value: string, options: CookieOptions) {
              cookieStore.set({ name, value, ...options });
            },
            remove(name: string, options: CookieOptions) {
              cookieStore.set({ name, value: '', ...options });
            },
          },
        }
      );

      // Exchange code for session
      const { error } = await supabase.auth.exchangeCodeForSession(code);

      if (error) {
        console.error('Auth callback error:', error);
        return NextResponse.redirect(
          new URL('/ycode?auth_error=auth', request.url)
        );
      }

      // Redirect to builder while preserving the email auth intent. Recovery
      // and invite links must show password setup instead of behaving like a
      // plain magic-link login after the server has already exchanged the code.
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
