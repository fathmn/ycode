import { NextRequest, NextResponse } from 'next/server';
import { setSettings } from '@/lib/repositories/settingsRepository';
import { clearAllCache, getAllPublishedRoutes, warmRoutes } from '@/lib/services/cacheService';
import { recordStudioCustomCodeMutation, requireStudioProjectRole, type StudioProjectRole } from '@/lib/studio-platform';

const CUSTOM_CODE_SETTING_KEYS = new Set(['custom_code_head', 'custom_code_body']);
const OPERATOR_ONLY_SETTING_KEYS = new Set(['email']);
const SETTINGS_WRITE_ROLES: StudioProjectRole[] = [
  'studio_admin',
  'studio_developer',
  'customer_owner',
  'customer_editor',
];
const SETTINGS_OPERATOR_ROLES: StudioProjectRole[] = [
  'studio_admin',
  'studio_developer',
];

/**
 * Setting keys that don't affect public-page rendering. Mirrors the list in
 * /ycode/api/settings/[key]/route.ts — keep them in sync.
 */
const DRAFT_ONLY_SETTING_KEYS = new Set(['draft_css', 'email']);

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

    const requestedKeys = Object.keys(settings);
    const roles = requestedKeys.some((key) => OPERATOR_ONLY_SETTING_KEYS.has(key))
      ? SETTINGS_OPERATOR_ROLES
      : SETTINGS_WRITE_ROLES;
    const roleCheck = await requireStudioProjectRole(request, roles);
    if (!roleCheck.ok) return roleCheck.response;

    const count = await setSettings(settings, roleCheck.context.project.id);

    // Only invalidate caches if any of the updated keys actually affect
    // public page rendering. Skips builder-only autosaves.
    const touchesPublicKeys = Object.keys(settings).some(
      (key) => !DRAFT_ONLY_SETTING_KEYS.has(key)
    );
    if (touchesPublicKeys) {
      await clearAllCache();

      // Prime the cache so the first visit to any public page after this
      // settings change doesn't pay the cold-cache cost. Capped inside
      // warmRoutes; long-tail routes self-warm on first real visit.
      try {
        const routes = await getAllPublishedRoutes();
        const warmResult = await warmRoutes(routes, request);
        if (warmResult) {
          console.log(
            `[Cache] settings batch: warming ${warmResult.warmed}${warmResult.total > warmResult.warmed ? ` of ${warmResult.total}` : ''} route(s) in background`,
          );
        }
      } catch {
        // Non-fatal: warming is an optimization
      }
    }

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
