import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { credentials } from '@/lib/credentials';
import { parseSupabaseConfig } from '@/lib/supabase-config-parser';
import type { SupabaseConfig } from '@/types';

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
      const config = await credentials.get<SupabaseConfig>('supabase_config');

      if (!config) {
        return NextResponse.redirect(
          new URL('/ycode?auth_error=config', request.url)
        );
      }

      const parsed = parseSupabaseConfig(config);
      const redirectUrl = new URL('/ycode', request.url);
      if (authFlow) {
        redirectUrl.searchParams.set('auth_flow', authFlow);
      }
      const response = NextResponse.redirect(redirectUrl);

      // Create Supabase client
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

      // Exchange code for session
      const { error } = await supabase.auth.exchangeCodeForSession(code);

      if (error) {
        console.error('Auth callback error:', error);
        return NextResponse.redirect(
          new URL('/ycode?auth_error=auth', request.url)
        );
      }

      return response;
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
