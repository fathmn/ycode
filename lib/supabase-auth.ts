/**
 * Server-side auth utilities for API routes.
 * Creates a Supabase client from cookies and verifies the session.
 */

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { credentials } from '@/lib/credentials';
import { parseSupabaseConfig } from '@/lib/supabase-config-parser';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { SupabaseConfig } from '@/types';

interface AuthResult {
  user: User;
  client: SupabaseClient;
}

function isReadOnlyCookieStoreError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const message = error instanceof Error
    ? error.message
    : String((error as { message?: unknown }).message || '');
  return message.includes('Cookies can only be modified');
}

/**
 * Get the authenticated user and Supabase client from request cookies.
 * Returns null if not authenticated or Supabase is not configured.
 */
export async function getAuthUser(): Promise<AuthResult | null> {
  try {
    const config = await credentials.get<SupabaseConfig>('supabase_config');
    if (!config) return null;

    const parsed = parseSupabaseConfig(config);
    const cookieStore = await cookies();

    const client = createServerClient(parsed.projectUrl, parsed.anonKey, {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set({ name, value, ...options });
            });
          } catch (error) {
            if (!isReadOnlyCookieStoreError(error)) {
              throw error;
            }
            // Server components can read auth cookies but cannot persist refreshed
            // Supabase cookies. Middleware/route handlers handle cookie refreshes.
          }
        },
      },
    });

    const { data: { user }, error } = await client.auth.getUser();
    if (error || !user) return null;

    return { user, client };
  } catch {
    return null;
  }
}
