import { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { credentials } from '@/lib/credentials';
import { parseSupabaseConfig } from '@/lib/supabase-config-parser';
import { cookies } from 'next/headers';
import { noCache } from '@/lib/api-response';
import type { SupabaseConfig } from '@/types';

/**
 * GET /ycode/api/auth/session
 * 
 * Get current user session
 */
export async function GET(request: NextRequest) {
  try {
    // Get Supabase config
    const config = await credentials.get<SupabaseConfig>('supabase_config');

    if (!config) {
      return noCache(
        { error: 'Supabase not configured' },
        500
      );
    }

    const cookieStore = await cookies();
    const parsed = parseSupabaseConfig(config);

    // Create Supabase client
    const supabase = createServerClient(
      parsed.projectUrl,
      parsed.anonKey,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set({ name, value, ...options });
            });
          },
        },
      }
    );

    // Get session, then validate the user server-side. Supabase warns that
    // getSession() reads client-owned storage and must not be trusted as user
    // identity without getUser().
    const { data: { session }, error } = await supabase.auth.getSession();

    if (error) {
      return noCache(
        { error: error.message },
        401
      );
    }

    if (!session?.access_token) {
      return noCache({
        data: {
          session: null,
          user: null,
        },
      });
    }

    const { data: { user }, error: userError } = await supabase.auth.getUser(session.access_token);

    if (userError || !user) {
      return noCache(
        { error: userError?.message || 'Invalid session user' },
        401
      );
    }

    const trustedSession = { ...session, user };

    return noCache({
      data: {
        session: trustedSession,
        user,
      },
    });
  } catch (error) {
    console.error('Session check failed:', error);
    
    return noCache(
      { error: 'Session check failed' },
      500
    );
  }
}
