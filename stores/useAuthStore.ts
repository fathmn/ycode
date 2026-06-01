/**
 * Auth Store
 *
 * Manages authentication state using Supabase Auth
 */

import { create } from 'zustand';
import { createBrowserClient } from '../lib/supabase-browser';
import {
  applySupabaseEmailAuthUrlSession,
  clearSupabaseEmailAuthFlowIntent,
  hasSupabaseEmailAuthUrl,
} from '../lib/supabase-email-auth-url';
import type { User, Session } from '@supabase/supabase-js';

type PasswordSetupType = 'invite' | 'recovery';

interface AuthState {
  user: User | null;
  session: Session | null;
  loading: boolean;
  initialized: boolean;
  error: string | null;
  passwordSetupRequired: boolean;
  passwordSetupType: PasswordSetupType | null;
}

interface AuthActions {
  initialize: () => Promise<void>;
  signUp: (email: string, password: string) => Promise<{ error: string | null }>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signInWithMagicLink: (email: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  checkSession: () => Promise<void>;
  setError: (error: string | null) => void;
  startPasswordSetup: (type: PasswordSetupType) => void;
  clearPasswordSetup: () => void;
}

type AuthStore = AuthState & AuthActions;

function passwordSetupTypeFromFlow(flow: string | null): PasswordSetupType | null {
  if (flow === 'invite' || flow === 'recovery') {
    return flow;
  }
  return null;
}

export const useAuthStore = create<AuthStore>((set, get) => ({
  user: null,
  session: null,
  loading: false,
  initialized: false,
  error: null,
  passwordSetupRequired: false,
  passwordSetupType: null,

  /**
   * Initialize auth state and listen for auth changes
   * Gracefully handles missing Supabase config (expected during setup)
   */
  initialize: async () => {
    if (get().initialized && !hasSupabaseEmailAuthUrl()) return;

    try {
      const supabase = await createBrowserClient();

      // If Supabase is not configured, skip initialization (expected during setup)
      if (!supabase) {
        set({
          initialized: true,
          error: null,
        });
        return;
      }

      // Listen for auth changes
      supabase.auth.onAuthStateChange((event, session) => {
        set({
          user: session?.user ?? null,
          session,
          ...(event === 'PASSWORD_RECOVERY'
            ? {
              passwordSetupRequired: true,
              passwordSetupType: 'recovery' as const,
            }
            : {}),
        });
      });

      const authUrlResult = await applySupabaseEmailAuthUrlSession(supabase);
      if (authUrlResult.error) {
        set({
          user: null,
          session: null,
          loading: false,
          initialized: true,
          error: authUrlResult.error,
        });
        return;
      }

      // Validate session server-side (getUser verifies the JWT, unlike getSession)
      const { data: { user } } = await supabase.auth.getUser();
      const { data: { session } } = await supabase.auth.getSession();
      const passwordSetupType = passwordSetupTypeFromFlow(authUrlResult.flow);
      const shouldRequirePasswordSetup = Boolean(
        passwordSetupType
        && (authUrlResult.sessionApplied || (user && session))
      );

      set({
        user: user ?? null,
        session: user ? session : null,
        initialized: true,
        ...(shouldRequirePasswordSetup
          ? {
            passwordSetupRequired: true,
            passwordSetupType,
          }
          : {}),
      });
    } catch (error) {
      console.error('Failed to initialize auth:', error);
      set({
        error: error instanceof Error ? error.message : 'Failed to initialize auth',
        initialized: true,
      });
    }
  },

  /**
   * Sign up a new user
   */
  signUp: async (email, password) => {
    set({ loading: true, error: null });

    try {
      const supabase = await createBrowserClient();

      if (!supabase) {
        set({ loading: false, error: 'Supabase not configured. Please complete setup first.' });
        return { error: 'Supabase not configured. Please complete setup first.' };
      }

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/ycode?auth_flow=magiclink`,
          // Note: Email confirmation should be disabled in Supabase Dashboard
          // (Authentication → Providers → Email → Disable "Confirm email")
          // This is recommended for self-hosted single-admin setups
        },
      });

      if (error) {
        set({ loading: false, error: error.message });
        return { error: error.message };
      }

      // Check if email confirmation is required
      if (data.user && !data.session) {
        const message = 'Email confirmation required. Please disable email confirmation in your Supabase project settings (Authentication → Providers → Email).';
        set({ loading: false, error: message });
        return { error: message };
      }

      clearSupabaseEmailAuthFlowIntent();
      set({
        user: data.user,
        session: data.session,
        loading: false,
        passwordSetupRequired: false,
        passwordSetupType: null,
      });

      return { error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Sign up failed';
      set({ loading: false, error: message });
      return { error: message };
    }
  },

  /**
   * Sign in existing user
   */
  signIn: async (email, password) => {
    set({ loading: true, error: null });

    try {
      const supabase = await createBrowserClient();

      if (!supabase) {
        set({ loading: false, error: 'Supabase not configured. Please complete setup first.' });
        return { error: 'Supabase not configured. Please complete setup first.' };
      }

      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        set({ loading: false, error: error.message });
        return { error: error.message };
      }

      clearSupabaseEmailAuthFlowIntent();
      set({
        user: data.user,
        session: data.session,
        loading: false,
        passwordSetupRequired: false,
        passwordSetupType: null,
      });

      return { error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Sign in failed';
      set({ loading: false, error: message });
      return { error: message };
    }
  },

  /**
   * Send a passwordless login link for an existing invited user.
   */
  signInWithMagicLink: async (email) => {
    set({ loading: true, error: null });

    try {
      const supabase = await createBrowserClient();

      if (!supabase) {
        set({ loading: false, error: 'Supabase not configured. Please complete setup first.' });
        return { error: 'Supabase not configured. Please complete setup first.' };
      }

      clearSupabaseEmailAuthFlowIntent();
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/ycode/api/auth/callback?auth_flow=magiclink`,
          shouldCreateUser: false,
        },
      });

      if (error) {
        set({ loading: false, error: error.message });
        return { error: error.message };
      }

      set({ loading: false });
      return { error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Magic link sign in failed';
      set({ loading: false, error: message });
      return { error: message };
    }
  },

  /**
   * Sign out current user
   */
  signOut: async () => {
    set({ loading: true, error: null });

    try {
      const supabase = await createBrowserClient();

      if (!supabase) {
        // If Supabase is not configured, just clear local state
        clearSupabaseEmailAuthFlowIntent();
        set({
          user: null,
          session: null,
          loading: false,
          passwordSetupRequired: false,
          passwordSetupType: null,
        });
        return;
      }

      clearSupabaseEmailAuthFlowIntent();
      const { error } = await supabase.auth.signOut();

      if (error) {
        set({ loading: false, error: error.message });
        return;
      }

      set({
        user: null,
        session: null,
        loading: false,
        passwordSetupRequired: false,
        passwordSetupType: null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Sign out failed';
      set({ loading: false, error: message });
    }
  },

  /**
   * Check current session
   */
  checkSession: async () => {
    try {
      const supabase = await createBrowserClient();

      if (!supabase) {
        return;
      }

      const { data: { user } } = await supabase.auth.getUser();
      const { data: { session } } = await supabase.auth.getSession();

      set({
        user: user ?? null,
        session: user ? session : null,
      });
    } catch (error) {
      console.error('Failed to check session:', error);
    }
  },

  /**
   * Set error message
   */
  setError: (error) => {
    set({ error });
  },

  startPasswordSetup: (type) => {
    set({
      passwordSetupRequired: true,
      passwordSetupType: type,
    });
  },

  clearPasswordSetup: () => {
    clearSupabaseEmailAuthFlowIntent();
    set({
      passwordSetupRequired: false,
      passwordSetupType: null,
    });
  },
}));
