import { NextRequest } from 'next/server';
import { noCache } from '@/lib/api-response';
import { getAuthUser } from '@/lib/supabase-auth';

/**
 * PUT /ycode/api/profile/email
 *
 * Update user's email address (requires password confirmation)
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password } = body;

    if (!email || typeof email !== 'string') {
      return noCache({ error: 'E-Mail-Adresse ist erforderlich.' }, 400);
    }

    if (!password || typeof password !== 'string') {
      return noCache({ error: 'Zum Ändern der E-Mail-Adresse ist das aktuelle Passwort erforderlich.' }, 400);
    }

    const auth = await getAuthUser();
    if (!auth) {
      return noCache({ error: 'Nicht angemeldet.' }, 401);
    }

    // Verify current password by re-authenticating
    const { error: signInError } = await auth.client.auth.signInWithPassword({
      email: auth.user.email!,
      password,
    });

    if (signInError) {
      return noCache({ error: 'Das aktuelle Passwort ist falsch.' }, 400);
    }

    // Update email
    const { data, error } = await auth.client.auth.updateUser({
      email: email.trim(),
    });

    if (error) {
      return noCache({ error: error.message }, 400);
    }

    return noCache({
      data: {
        user: data.user,
        message: 'E-Mail-Änderung gestartet. Bitte bestätigen Sie die neue E-Mail-Adresse.',
      },
    });
  } catch (error) {
    console.error('Failed to update email:', error);
    return noCache({ error: 'E-Mail-Adresse konnte nicht gespeichert werden.' }, 500);
  }
}
