import { NextRequest } from 'next/server';
import { noCache } from '@/lib/api-response';
import { getAuthUser } from '@/lib/supabase-auth';

/**
 * PUT /ycode/api/profile/password
 *
 * Update user's password (requires current password)
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { currentPassword, newPassword } = body;

    if (!currentPassword || typeof currentPassword !== 'string') {
      return noCache({ error: 'Aktuelles Passwort ist erforderlich.' }, 400);
    }

    if (!newPassword || typeof newPassword !== 'string') {
      return noCache({ error: 'Neues Passwort ist erforderlich.' }, 400);
    }

    if (newPassword.length < 6) {
      return noCache({ error: 'Das neue Passwort muss mindestens 6 Zeichen lang sein.' }, 400);
    }

    const auth = await getAuthUser();
    if (!auth) {
      return noCache({ error: 'Nicht angemeldet.' }, 401);
    }

    // Verify current password by re-authenticating
    const { error: signInError } = await auth.client.auth.signInWithPassword({
      email: auth.user.email!,
      password: currentPassword,
    });

    if (signInError) {
      return noCache({ error: 'Das aktuelle Passwort ist falsch.' }, 400);
    }

    // Update password
    const { data, error } = await auth.client.auth.updateUser({
      password: newPassword,
    });

    if (error) {
      console.error('Failed to update password:', error);
      return noCache({ error: `Passwort konnte nicht gespeichert werden: ${error.message}` }, 400);
    }

    if (!data.user) {
      return noCache({ error: 'Passwort konnte nicht gespeichert werden.' }, 500);
    }

    return noCache({
      data: {
        success: true,
        message: 'Passwort wurde gespeichert.',
      },
    });
  } catch (error) {
    console.error('Failed to update password:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return noCache({ error: `Passwort konnte nicht gespeichert werden: ${message}` }, 500);
  }
}
