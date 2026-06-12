import { createRouteClient } from '@/lib/supabase-route-client';
import { noCache } from '@/lib/api-response';

/**
 * GET /ycode/api/auth/session
 *
 * Get current user session
 */
export async function GET() {
  try {
    const supabase = await createRouteClient();

    if (!supabase) {
      return noCache(
        { error: 'Supabase not configured' },
        500
      );
    }

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
