'use client';

/**
 * Accept Invite Page
 *
 * Handles user invitation flow - allows invited users to set their password
 * and complete their account setup.
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@/lib/supabase-browser';
import { applySupabaseEmailAuthUrlSession } from '@/lib/supabase-email-auth-url';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSet,
} from '@/components/ui/field';

export default function AcceptInvitePage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  // Ensure dark mode is applied
  useEffect(() => {
    document.documentElement.classList.add('dark');

    return () => {
      document.documentElement.classList.remove('dark');
    };
  }, []);

  // Verify the invite token on mount
  useEffect(() => {
    const verifyInvite = async () => {
      try {
        const supabase = await createBrowserClient();

        if (!supabase) {
          setError('Studio ist nicht konfiguriert. Bitte wenden Sie sich an den Administrator.');
          setVerifying(false);
          return;
        }

        const authUrlResult = await applySupabaseEmailAuthUrlSession(supabase, {
          defaultCodeFlow: 'invite',
        });
        if (authUrlResult.error) {
          setError('Ungültiger oder abgelaufener Einladungslink. Bitte fordern Sie eine neue Einladung an.');
          setVerifying(false);
          return;
        }
        if (authUrlResult.sessionApplied) {
          setUserEmail(authUrlResult.user?.email || null);
          setVerifying(false);
          return;
        }

        // Check if user is already logged in (maybe clicked link while logged in)
        const { data: { session } } = await supabase.auth.getSession();

        if (session?.user) {
          // User is already authenticated, redirect to app
          router.push('/ycode');
          return;
        }

        // No valid token found
        setError('Ungültiger Einladungslink. Bitte prüfen Sie die E-Mail oder fordern Sie eine neue Einladung an.');
        setVerifying(false);
      } catch (err) {
        console.error('Error verifying invite:', err);
        setError('Einladung konnte nicht geprüft werden. Bitte versuchen Sie es erneut.');
        setVerifying(false);
      }
    };

    verifyInvite();
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validate passwords
    if (!password || !confirmPassword) {
      setError('Bitte füllen Sie alle Felder aus.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Die Passwörter stimmen nicht überein.');
      return;
    }

    if (password.length < 8) {
      setError('Das Passwort muss mindestens 8 Zeichen lang sein.');
      return;
    }

    setLoading(true);

    try {
      const supabase = await createBrowserClient();

      if (!supabase) {
        setError('Studio ist nicht konfiguriert.');
        setLoading(false);
        return;
      }

      // Update the user's password
      const { error: updateError } = await supabase.auth.updateUser({
        password: password,
      });

      if (updateError) {
        setError(updateError.message);
        setLoading(false);
        return;
      }

      // Success! Redirect to the app
      router.push('/ycode');
    } catch (err) {
      console.error('Error setting password:', err);
      setError('Passwort konnte nicht gespeichert werden. Bitte versuchen Sie es erneut.');
      setLoading(false);
    }
  };

  // Show loading while verifying
  if (verifying) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-950">
        <div className="flex flex-col items-center gap-4">
          <Spinner />
          <Label variant="muted">Einladung wird geprüft...</Label>
        </div>
      </div>
    );
  }

  // Show error state if verification failed
  if (error && !userEmail) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-950">
        <div className="w-full max-w-md p-8">
          <div className="flex flex-col items-center gap-6">
            <svg
              className="size-10 fill-current"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
            >
              <g
                stroke="none" strokeWidth="1"
                fill="none" fillRule="evenodd"
              >
                <g transform="translate(-30.000000, -30.000000)">
                  <g>
                    <g transform="translate(30.000000, 30.000000)">
                      <rect
                        x="0" y="0"
                        width="24" height="24"
                      />
                      <path
                        d="M11.4241533,0 L11.4241533,5.85877951 L6.024,8.978 L12.6155735,12.7868008 L10.951,13.749 L23.0465401,6.75101349 L23.0465401,12.6152717 L3.39516096,23.9856666 L3.3703726,24 L3.34318129,23.9827156 L0.96,22.4713365 L0.96,16.7616508 L3.36417551,18.1393242 L7.476,15.76 L0.96,11.9090099 L0.96,6.05375516 L11.4241533,0 Z"
                        className="fill-current"
                      />
                    </g>
                  </g>
                </g>
              </g>
            </svg>

            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>

            <Button
              variant="secondary"
              onClick={() => router.push('/login')}
            >
              Zum Login
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Show password setup form
  return (
    <div className="min-h-screen flex flex-col bg-neutral-950">
      <div className="pt-12 pb-8 flex items-center justify-center">
        <svg
          className="size-5 fill-current"
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
        >
          <g
            stroke="none" strokeWidth="1"
            fill="none" fillRule="evenodd"
          >
            <g transform="translate(-30.000000, -30.000000)">
              <g>
                <g transform="translate(30.000000, 30.000000)">
                  <rect
                    x="0" y="0"
                    width="24" height="24"
                  />
                  <path
                    d="M11.4241533,0 L11.4241533,5.85877951 L6.024,8.978 L12.6155735,12.7868008 L10.951,13.749 L23.0465401,6.75101349 L23.0465401,12.6152717 L3.39516096,23.9856666 L3.3703726,24 L3.34318129,23.9827156 L0.96,22.4713365 L0.96,16.7616508 L3.36417551,18.1393242 L7.476,15.76 L0.96,11.9090099 L0.96,6.05375516 L11.4241533,0 Z"
                    className="fill-current"
                  />
                </g>
              </g>
            </g>
          </g>
        </svg>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center py-10">
        <div className="w-full max-w-md px-8">
          <form onSubmit={handleSubmit}>
            <FieldGroup
              className="animate-in fade-in slide-in-from-bottom-1 duration-700"
              style={{ animationFillMode: 'both' }}
            >
              {userEmail && (
                <div className="text-center mb-6">
                  <Label variant="muted" size="sm">
                    Konto einrichten für {userEmail}
                  </Label>
                </div>
              )}

              <FieldSet>
                <FieldGroup className="gap-6">
                  {error && (
                    <Alert variant="destructive">
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  )}

                  <Field>
                    <FieldLabel htmlFor="password" size="sm">
                      Passwort
                    </FieldLabel>
                    <Input
                      type="password"
                      id="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      disabled={loading}
                      size="sm"
                      autoFocus
                    />
                    <FieldDescription>Mindestens 8 Zeichen</FieldDescription>
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="confirmPassword" size="sm">
                      Passwort bestätigen
                    </FieldLabel>
                    <Input
                      type="password"
                      id="confirmPassword"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      disabled={loading}
                      size="sm"
                    />
                  </Field>

                  <Button
                    type="submit"
                    disabled={loading}
                    className="w-full mt-4"
                  >
                    {loading ? <Spinner /> : 'Konto erstellen'}
                  </Button>
                </FieldGroup>
              </FieldSet>
            </FieldGroup>
          </form>
        </div>
      </div>
    </div>
  );
}
