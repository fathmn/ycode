import { NextRequest } from 'next/server';
import { noCache } from '@/lib/api-response';
import { getAuthUser } from '@/lib/supabase-auth';

/**
 * PUT /ycode/api/profile/name
 *
 * Update user's display name
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { name } = body;

    if (!name || typeof name !== 'string') {
      return noCache({ error: 'Name ist erforderlich.' }, 400);
    }

    const auth = await getAuthUser();
    if (!auth) {
      return noCache({ error: 'Nicht angemeldet.' }, 401);
    }

    // Update user metadata
    const { data, error } = await auth.client.auth.updateUser({
      data: {
        display_name: name.trim(),
        full_name: name.trim(),
      },
    });

    if (error) {
      return noCache({ error: error.message }, 400);
    }

    return noCache({
      data: {
        user: data.user,
      },
    });
  } catch (error) {
    console.error('Failed to update name:', error);
    return noCache({ error: 'Name konnte nicht gespeichert werden.' }, 500);
  }
}
