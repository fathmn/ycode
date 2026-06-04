import { NextRequest } from 'next/server';
import { noCache } from '@/lib/api-response';
import { getAuthUser } from '@/lib/supabase-auth';
import { getSupabaseAdmin } from '@/lib/supabase-server';

/**
 * DELETE /ycode/api/profile
 *
 * Delete user's profile and account
 */
export async function DELETE(request: NextRequest) {
  try {
    const auth = await getAuthUser();
    if (!auth) {
      return noCache({ error: 'Nicht angemeldet.' }, 401);
    }

    // Use admin client to delete user
    const adminClient = await getSupabaseAdmin();

    if (!adminClient) {
      return noCache({ error: 'Serverkonfiguration unvollständig.' }, 500);
    }

    // Delete user using admin client
    const { error } = await adminClient.auth.admin.deleteUser(auth.user.id);

    if (error) {
      console.error('Failed to delete user:', error);
      return noCache({ error: error.message }, 400);
    }

    // Sign out the user
    await auth.client.auth.signOut();

    return noCache({
      data: {
        success: true,
        message: 'Profil wurde gelöscht.',
      },
    });
  } catch (error) {
    console.error('Failed to delete profile:', error);
    return noCache({ error: 'Profil konnte nicht gelöscht werden.' }, 500);
  }
}
