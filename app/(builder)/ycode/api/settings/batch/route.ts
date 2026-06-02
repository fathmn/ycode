import { NextRequest, NextResponse } from 'next/server';
import { setSettings } from '@/lib/repositories/settingsRepository';
import { clearAllCache } from '@/lib/services/cacheService';
import { recordStudioCustomCodeMutation, requireStudioProjectRole } from '@/lib/studio-platform';

const CUSTOM_CODE_SETTING_KEYS = new Set(['custom_code_head', 'custom_code_body']);

/**
 * PUT /ycode/api/settings/batch
 *
 * Update multiple settings at once.
 * Invalidates the public page cache so ISR pages pick up the new values.
 * Request body: { settings: { key1: value1, key2: value2, ... } }
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { settings } = body;

    if (!settings || typeof settings !== 'object') {
      return NextResponse.json(
        { error: 'Missing or invalid settings object in request body' },
        { status: 400 }
      );
    }

    const roleCheck = await requireStudioProjectRole(request, [
      'studio_admin',
      'studio_developer',
      'customer_owner',
      'customer_editor',
    ]);
    if (!roleCheck.ok) return roleCheck.response;

    const count = await setSettings(settings, roleCheck.context.project.id);

    await clearAllCache();

    for (const [key, value] of Object.entries(settings)) {
      if (!CUSTOM_CODE_SETTING_KEYS.has(key)) continue;

      await recordStudioCustomCodeMutation(request, {
        scope: 'global',
        targetId: key,
        content: typeof value === 'string' ? value : JSON.stringify(value ?? ''),
        metadata: {
          route: '/ycode/api/settings/batch',
          settingKey: key,
        },
      });
    }

    return NextResponse.json({
      data: { count },
      message: `Updated ${count} setting(s) successfully`,
    });
  } catch (error) {
    console.error('[API] Error updating settings:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update settings' },
      { status: 500 }
    );
  }
}
