import { NextRequest } from 'next/server';
import {
  getAppSettings,
  setAppSetting,
  deleteAllAppSettings,
} from '@/lib/repositories/appSettingsRepository';
import { getAppById } from '@/lib/apps/registry';
import { cleanupWebhooks as cleanupAirtableWebhooks } from '@/lib/apps/airtable/sync-service';
import { noCache } from '@/lib/api-response';
import { requireStudioIntegrationManager } from '@/lib/studio-integration-access';

// Disable caching for this route
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /ycode/api/apps/[appId]/settings
 * Get all settings for a specific app
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string }> }
) {
  try {
    const roleCheck = await requireStudioIntegrationManager(request);
    if (!roleCheck.ok) return roleCheck.response;

    const { appId } = await params;

    const app = getAppById(appId);
    if (!app) {
      return noCache({ error: 'App not found' }, 404);
    }

    const settings = await getAppSettings(appId, roleCheck.context.project.id);

    // Convert to a key-value map for easier consumption
    const settingsMap: Record<string, unknown> = {};
    for (const setting of settings) {
      settingsMap[setting.key] = setting.value;
    }

    return noCache({ data: settingsMap });
  } catch (error) {
    console.error('Error fetching app settings:', error);
    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to fetch app settings' },
      500
    );
  }
}

/**
 * PUT /ycode/api/apps/[appId]/settings
 * Update settings for a specific app
 *
 * Body: { [key]: value, ... }
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string }> }
) {
  try {
    const { appId } = await params;

    const app = getAppById(appId);
    if (!app) {
      return noCache({ error: 'App not found' }, 404);
    }

    const body = await request.json();
    const roleCheck = await requireStudioIntegrationManager(request);
    if (!roleCheck.ok) return roleCheck.response;

    // Update each setting
    for (const [key, value] of Object.entries(body)) {
      await setAppSetting(appId, key, value, roleCheck.context.project.id);
    }

    // Return updated settings
    const settings = await getAppSettings(appId, roleCheck.context.project.id);
    const settingsMap: Record<string, unknown> = {};
    for (const setting of settings) {
      settingsMap[setting.key] = setting.value;
    }

    return noCache({ data: settingsMap });
  } catch (error) {
    console.error('Error updating app settings:', error);
    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to update app settings' },
      500
    );
  }
}

/**
 * DELETE /ycode/api/apps/[appId]/settings
 * Delete all settings for a specific app (disconnect)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string }> }
) {
  try {
    const roleCheck = await requireStudioIntegrationManager(request);
    if (!roleCheck.ok) return roleCheck.response;

    const { appId } = await params;

    const app = getAppById(appId);
    if (!app) {
      return noCache({ error: 'App not found' }, 404);
    }

    if (appId === 'airtable') {
      await cleanupAirtableWebhooks(roleCheck.context.project.id);
    }

    await deleteAllAppSettings(appId, roleCheck.context.project.id);

    return noCache({ message: 'App disconnected successfully' });
  } catch (error) {
    console.error('Error disconnecting app:', error);
    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to disconnect app' },
      500
    );
  }
}
