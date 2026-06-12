import { NextRequest, NextResponse } from 'next/server';
import { getSettingByKey, setSetting } from '@/lib/repositories/settingsRepository';
import { clearAllCache, getAllPublishedRoutes, warmRoutes } from '@/lib/services/cacheService';
import { recordStudioCustomCodeMutation, requireStudioProjectRole, type StudioProjectRole } from '@/lib/studio-platform';

const CUSTOM_CODE_SETTING_KEYS = new Set(['custom_code_head', 'custom_code_body']);
const OPERATOR_ONLY_SETTING_KEYS = new Set(['email']);
const SETTINGS_READ_ROLES: StudioProjectRole[] = [
  'studio_admin',
  'studio_developer',
  'customer_owner',
  'customer_editor',
  'customer_viewer',
];
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

function rolesForSettingKey(key: string, fallbackRoles: StudioProjectRole[]): StudioProjectRole[] {
  return OPERATOR_ONLY_SETTING_KEYS.has(key) ? SETTINGS_OPERATOR_ROLES : fallbackRoles;
}

/**
 * Setting keys that don't affect public-page rendering and therefore should
 * NOT trigger a cache nuke when updated.
 *
 * - `draft_css`: builder-only preview CSS. Public pages serve `published_css`.
 *   Saved on every edit, so invalidating here would purge every page on every
 *   keystroke and undo selective invalidation entirely.
 * - `email`: SMTP credentials for form submission backend. Not consumed by
 *   public page renders.
 *
 * All other keys (redirects, favicon_url, ga_measurement_id, published_css,
 * color variables, etc.) are read by public pages and DO require invalidation.
 */
const DRAFT_ONLY_SETTING_KEYS = new Set(['draft_css', 'email']);

/**
 * GET /ycode/api/settings/[key]
 *
 * Get a setting value by key
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  try {
    const { key } = await params;
    const roleCheck = await requireStudioProjectRole(request, rolesForSettingKey(key, SETTINGS_READ_ROLES));
    if (!roleCheck.ok) return roleCheck.response;

    const value = await getSettingByKey(key, roleCheck.context.project.id);

    if (value === null) {
      return NextResponse.json(
        { error: 'Setting not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ data: value });
  } catch (error) {
    console.error('[API] Error fetching setting:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch setting' },
      { status: 500 }
    );
  }
}

/**
 * PUT /ycode/api/settings/[key]
 *
 * Update a setting value
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  try {
    const { key } = await params;
    const body = await request.json();
    const { value } = body;

    if (value === undefined) {
      return NextResponse.json(
        { error: 'Missing value in request body' },
        { status: 400 }
      );
    }

    const roleCheck = await requireStudioProjectRole(request, rolesForSettingKey(key, SETTINGS_WRITE_ROLES));
    if (!roleCheck.ok) return roleCheck.response;

    await setSetting(key, value, roleCheck.context.project.id);

    // Skip cache invalidation for draft/internal settings so builder
    // autosaves don't purge the public CDN cache on every edit.
    if (!DRAFT_ONLY_SETTING_KEYS.has(key)) {
      await clearAllCache();

      // Prime the cache so the first visit to any public page after this
      // settings change doesn't pay the cold-cache cost. Capped inside
      // warmRoutes; long-tail routes self-warm on first real visit.
      try {
        const routes = await getAllPublishedRoutes();
        const warmResult = await warmRoutes(routes, request);
        if (warmResult) {
          console.log(
            `[Cache] settings (${key}): warming ${warmResult.warmed}${warmResult.total > warmResult.warmed ? ` of ${warmResult.total}` : ''} route(s) in background`,
          );
        }
      } catch {
        // Non-fatal: warming is an optimization
      }
    }

    if (CUSTOM_CODE_SETTING_KEYS.has(key)) {
      await recordStudioCustomCodeMutation(request, {
        scope: 'global',
        targetId: key,
        content: typeof value === 'string' ? value : JSON.stringify(value ?? ''),
        metadata: {
          route: '/ycode/api/settings/[key]',
          settingKey: key,
        },
      });
    }

    return NextResponse.json({
      data: { key, value },
      message: 'Setting updated successfully',
    });
  } catch (error) {
    console.error('[API] Error updating setting:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update setting' },
      { status: 500 }
    );
  }
}
