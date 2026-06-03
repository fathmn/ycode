'use client';

import { useCallback, useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { studioFetch } from '@/lib/api';
import { createBrowserClient } from '@/lib/supabase-browser';
import { useAuthStore } from '@/stores/useAuthStore';
import BuilderLoading from '@/components/BuilderLoading';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { toast } from 'sonner';

type StudioAuthGateProps = {
  children: ReactNode;
  skipSetupCheck?: boolean;
};

export default function StudioAuthGate({ children, skipSetupCheck = false }: StudioAuthGateProps) {
  const router = useRouter();
  const { initialize } = useAuthStore();
  const user = useAuthStore((state) => state.user);
  const authInitialized = useAuthStore((state) => state.initialized);
  const authError = useAuthStore((state) => state.error);
  const authPasswordSetupRequired = useAuthStore((state) => state.passwordSetupRequired);
  const authPasswordSetupType = useAuthStore((state) => state.passwordSetupType);
  const clearAuthPasswordSetup = useAuthStore((state) => state.clearPasswordSetup);
  const [supabaseConfigured, setSupabaseConfigured] = useState<boolean | null>(skipSetupCheck ? true : null);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginNotice, setLoginNotice] = useState<string | null>(null);
  const [loginMode, setLoginMode] = useState<'magic' | 'password' | 'recovery'>('magic');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [passwordSetupPassword, setPasswordSetupPassword] = useState('');
  const [passwordSetupConfirm, setPasswordSetupConfirm] = useState('');
  const [passwordSetupError, setPasswordSetupError] = useState<string | null>(null);
  const [passwordSetupNotice, setPasswordSetupNotice] = useState<string | null>(null);
  const [isCompletingPasswordSetup, setIsCompletingPasswordSetup] = useState(false);

  useEffect(() => {
    initialize();
  }, [initialize]);

  useEffect(() => {
    if (skipSetupCheck) {
      setSupabaseConfigured(true);
      return;
    }

    const checkSupabaseConfig = async () => {
      try {
        const response = await studioFetch('/ycode/api/setup/status');
        const data = await response.json();

        if (!data.is_configured) {
          router.push('/ycode/welcome');
          return;
        }

        setSupabaseConfigured(true);
      } catch (err) {
        console.error('Failed to check Supabase config:', err);
        router.push('/ycode/welcome');
      }
    };

    checkSupabaseConfig();
  }, [router, skipSetupCheck]);

  useEffect(() => {
    if (!user || authPasswordSetupRequired) {
      document.documentElement.classList.add('dark');
    }
  }, [authPasswordSetupRequired, user]);

  const visibleLoginError = loginError || authError;

  const handleLogin = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    setIsLoggingIn(true);
    setLoginError(null);
    setLoginNotice(null);

    const { signIn } = useAuthStore.getState();
    const result = await signIn(loginEmail, loginPassword);

    if (result.error) {
      setLoginError(result.error);
      setIsLoggingIn(false);
    }
  }, [loginEmail, loginPassword]);

  const handleMagicLinkLogin = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    setIsLoggingIn(true);
    setLoginError(null);
    setLoginNotice(null);

    const { signInWithMagicLink } = useAuthStore.getState();
    const result = await signInWithMagicLink(loginEmail);

    if (result.error) {
      setLoginError(result.error);
    } else {
      setLoginNotice('Magic Link wurde versendet. Bitte öffnen Sie die E-Mail auf diesem Gerät.');
    }

    setIsLoggingIn(false);
  }, [loginEmail]);

  const handlePasswordRecovery = useCallback(async (e?: FormEvent) => {
    e?.preventDefault();
    const email = loginEmail.trim();
    setLoginError(null);
    setLoginNotice(null);

    if (!email) {
      setLoginError('Bitte geben Sie zuerst Ihre E-Mail-Adresse ein.');
      return;
    }

    setIsLoggingIn(true);

    try {
      const supabase = await createBrowserClient();
      if (!supabase) {
        setLoginError('Supabase ist nicht konfiguriert.');
        return;
      }

      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/ycode?auth_flow=recovery`,
      });

      if (error) {
        setLoginError(error.message);
        return;
      }

      setLoginNotice('Link zum Zurücksetzen wurde versendet. Bitte öffnen Sie die E-Mail und vergeben Sie ein neues Passwort.');
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : 'Passwort-Reset konnte nicht gestartet werden.');
    } finally {
      setIsLoggingIn(false);
    }
  }, [loginEmail]);

  const handlePasswordSetup = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    setPasswordSetupError(null);
    setPasswordSetupNotice(null);

    if (passwordSetupPassword.length < 8) {
      setPasswordSetupError('Das Passwort muss mindestens 8 Zeichen lang sein.');
      return;
    }

    if (passwordSetupPassword !== passwordSetupConfirm) {
      setPasswordSetupError('Die Passwörter stimmen nicht überein.');
      return;
    }

    setIsCompletingPasswordSetup(true);

    try {
      const supabase = await createBrowserClient();
      if (!supabase) {
        setPasswordSetupError('Supabase ist nicht konfiguriert.');
        return;
      }

      const { data: { user: activeUser }, error: userError } = await supabase.auth.getUser();
      if (userError || !activeUser) {
        setPasswordSetupError('Ihre Sitzung ist abgelaufen. Bitte öffnen Sie den Link erneut.');
        return;
      }

      const { error } = await supabase.auth.updateUser({
        password: passwordSetupPassword,
      });

      if (error) {
        setPasswordSetupError(error.message);
        return;
      }

      setPasswordSetupPassword('');
      setPasswordSetupConfirm('');
      clearAuthPasswordSetup();
      setPasswordSetupNotice(null);
      await useAuthStore.getState().checkSession();
      toast.success('Passwort wurde gespeichert.');
      if (window.location.pathname === '/') {
        router.replace('/ycode');
      }
    } catch (error) {
      setPasswordSetupError(error instanceof Error ? error.message : 'Passwort konnte nicht gespeichert werden.');
    } finally {
      setIsCompletingPasswordSetup(false);
    }
  }, [clearAuthPasswordSetup, passwordSetupConfirm, passwordSetupPassword, router]);

  if (supabaseConfigured === null) {
    return <BuilderLoading message="Konfiguration wird geprüft..." />;
  }

  if (!authInitialized) {
    return <BuilderLoading message="Anmeldung wird geprüft..." />;
  }

  if (authPasswordSetupRequired) {
    const title = authPasswordSetupType === 'recovery' ? 'Neues Passwort setzen' : 'Passwort anlegen';

    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-neutral-950 py-10">
        <div className="absolute bottom-10 text-[11px] font-medium tracking-[0.18em] text-white/45 uppercase">
          Studio
        </div>

        <div className="w-full max-w-sm animate-in fade-in slide-in-from-bottom-1 duration-700" style={{ animationFillMode: 'both' }}>
          <div className="mb-8 flex flex-col items-center gap-1 text-center">
            <Label className="text-white" size="sm">{title}</Label>
            <p className="text-xs text-white/50">
              {user?.email || 'Studio-Konto'}
            </p>
          </div>

          <form onSubmit={handlePasswordSetup} className="flex flex-col gap-6">
            {passwordSetupError && (
              <Alert variant="destructive">
                <AlertTitle>{passwordSetupError}</AlertTitle>
              </Alert>
            )}

            {(passwordSetupNotice || authPasswordSetupType) && (
              <Alert>
                <AlertTitle>
                  {passwordSetupNotice || (
                    authPasswordSetupType === 'recovery'
                      ? 'Bitte vergeben Sie ein neues Passwort für Ihr Studio-Konto.'
                      : 'Bitte legen Sie ein Passwort für Ihr Studio-Konto an.'
                  )}
                </AlertTitle>
              </Alert>
            )}

            <Field>
              <Label htmlFor="new-password">
                Neues Passwort
              </Label>
              <Input
                type="password"
                id="new-password"
                value={passwordSetupPassword}
                onChange={(e) => setPasswordSetupPassword(e.target.value)}
                placeholder="Mindestens 8 Zeichen"
                disabled={isCompletingPasswordSetup}
                autoComplete="new-password"
                required
              />
            </Field>

            <Field>
              <Label htmlFor="new-password-confirm">
                Passwort bestätigen
              </Label>
              <Input
                type="password"
                id="new-password-confirm"
                value={passwordSetupConfirm}
                onChange={(e) => setPasswordSetupConfirm(e.target.value)}
                placeholder="Passwort wiederholen"
                disabled={isCompletingPasswordSetup}
                autoComplete="new-password"
                required
              />
            </Field>

            <Button
              type="submit"
              size="sm"
              disabled={isCompletingPasswordSetup}
            >
              {isCompletingPasswordSetup ? <Spinner /> : 'Passwort speichern'}
            </Button>
          </form>

          <Alert className="mt-4">
            <AlertDescription>
              Nach dem Speichern wird dieses Passwort für den normalen Studio-Login verwendet.
            </AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-neutral-950 py-10">
        <div className="absolute bottom-10 text-[11px] font-medium tracking-[0.18em] text-white/45 uppercase">
          Studio
        </div>

        <div className="w-full max-w-sm animate-in fade-in slide-in-from-bottom-1 duration-700" style={{ animationFillMode: 'both' }}>
          <div className="mb-8 flex flex-col items-center gap-1 text-center">
            <Label className="text-white" size="sm">Studio</Label>
            <p className="text-xs text-white/50">Login für freigegebene Website-Projekte</p>
          </div>

          <form
            onSubmit={
              loginMode === 'magic'
                ? handleMagicLinkLogin
                : loginMode === 'recovery'
                  ? handlePasswordRecovery
                  : handleLogin
            }
            className="flex flex-col gap-6"
          >
            {visibleLoginError && (
              <Alert variant="destructive">
                <AlertTitle>{visibleLoginError}</AlertTitle>
              </Alert>
            )}

            {loginNotice && (
              <Alert>
                <AlertTitle>{loginNotice}</AlertTitle>
              </Alert>
            )}

            <Field>
              <Label htmlFor="email">
                E-Mail
              </Label>
              <Input
                type="email"
                id="email"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                placeholder="you@example.com"
                disabled={isLoggingIn}
                required
              />
            </Field>

            {loginMode === 'password' && (
              <Field>
                <Label htmlFor="password">
                  Passwort
                </Label>
                <Input
                  type="password"
                  id="password"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  placeholder="••••••••"
                  disabled={isLoggingIn}
                  autoComplete="current-password"
                  required
                />
              </Field>
            )}

            <Button
              type="submit"
              size="sm"
              disabled={isLoggingIn}
            >
              {isLoggingIn ? <Spinner /> : loginMode === 'magic'
                ? 'Magic Link senden'
                : loginMode === 'recovery'
                  ? 'Link zum Zurücksetzen senden'
                  : 'Mit Passwort einloggen'}
            </Button>
          </form>

          <div className="mt-4 flex flex-col items-center gap-3 text-center">
            {loginMode === 'password' && (
              <button
                type="button"
                className="text-xs font-medium text-white/70 underline-offset-4 hover:text-white hover:underline disabled:opacity-50"
                disabled={isLoggingIn}
                onClick={() => {
                  setLoginMode('recovery');
                  setLoginError(null);
                  setLoginNotice(null);
                }}
              >
                Passwort vergessen?
              </button>
            )}
            <button
              type="button"
              className="text-xs font-medium text-white/70 underline-offset-4 hover:text-white hover:underline"
              onClick={() => {
                setLoginMode(loginMode === 'magic' ? 'password' : 'magic');
                setLoginError(null);
                setLoginNotice(null);
              }}
            >
              {loginMode === 'magic'
                ? 'Mit Passwort einloggen'
                : loginMode === 'recovery'
                  ? 'Zurück zum Login'
                  : 'Stattdessen Magic Link senden'}
            </button>
            <p className="text-xs text-white/50">
              Noch keine Einladung erhalten? Bitte wenden Sie sich an novum partners.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
