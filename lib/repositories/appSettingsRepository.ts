import { getSupabaseAdmin } from '@/lib/supabase-server';
import {
  applyProjectScopeToQuery,
  isSharedDbProjectScopeRequired,
  tableHasProjectScopeColumn,
} from '@/lib/project-scope';

/**
 * App Settings Repository
 *
 * Generic key-value store for app integration settings.
 * Each app stores its configuration (API keys, connections, etc.) here.
 */

// =============================================================================
// Types
// =============================================================================

export interface AppSetting {
  id: string;
  app_id: string;
  key: string;
  value: unknown;
  project_id?: string | null;
  created_at: string;
  updated_at: string;
}

const APP_SETTING_FIELDS = 'id, app_id, key, value, created_at, updated_at';

async function appSettingSelectFields(client: any): Promise<string> {
  return (await tableHasProjectScopeColumn(client, 'app_settings'))
    ? `${APP_SETTING_FIELDS}, project_id`
    : APP_SETTING_FIELDS;
}

// =============================================================================
// Read Operations
// =============================================================================

/**
 * Get all settings for a specific app
 */
export async function getAppSettings(appId: string, projectId?: string | null): Promise<AppSetting[]> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase client not configured');
  }

  const selectFields = await appSettingSelectFields(client);
  let query = client
    .from('app_settings')
    .select(selectFields)
    .eq('app_id', appId)
    .order('key', { ascending: true });
  query = (await applyProjectScopeToQuery(query, client, 'app_settings', projectId)).query;

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to fetch app settings: ${error.message}`);
  }

  return (data || []) as unknown as AppSetting[];
}

/**
 * Get a specific setting for an app
 */
export async function getAppSetting(
  appId: string,
  key: string,
  projectId?: string | null
): Promise<AppSetting | null> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase client not configured');
  }

  let query = client
    .from('app_settings')
    .select('*')
    .eq('app_id', appId)
    .eq('key', key);
  if (projectId !== undefined) {
    query = (await applyProjectScopeToQuery(query, client, 'app_settings', projectId)).query;
  }

  const { data, error } = await query.single();

  if (error && error.code !== 'PGRST116') {
    throw new Error(`Failed to fetch app setting: ${error.message}`);
  }

  return data as AppSetting;
}

/**
 * Get a setting value directly (convenience helper)
 */
export async function getAppSettingValue<T = unknown>(
  appId: string,
  key: string,
  projectId?: string | null
): Promise<T | null> {
  const setting = await getAppSetting(appId, key, projectId);
  return setting ? (setting.value as T) : null;
}

/**
 * Check if an app has a specific setting configured
 */
export async function hasAppSetting(
  appId: string,
  key: string
): Promise<boolean> {
  const setting = await getAppSetting(appId, key);
  return setting !== null;
}

export async function getConnectedAppIds(projectId?: string | null): Promise<string[]> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase client not configured');
  }

  let query = client
    .from('app_settings')
    .select('app_id')
    .order('app_id');
  query = (await applyProjectScopeToQuery(query, client, 'app_settings', projectId)).query;

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to fetch connected apps: ${error.message}`);
  }

  // Deduplicate app IDs
  const appIds = new Set((data || []).map((row: { app_id: string }) => row.app_id));
  return Array.from(appIds);
}

// =============================================================================
// Write Operations
// =============================================================================

/**
 * Set a setting value for an app (upsert)
 */
export async function setAppSetting(
  appId: string,
  key: string,
  value: unknown,
  projectId?: string | null
): Promise<AppSetting> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase client not configured');
  }

  const hasProjectScope = await tableHasProjectScopeColumn(client, 'app_settings');
  if (!hasProjectScope && isSharedDbProjectScopeRequired()) {
    throw new Error('Project scope column is required for app_settings');
  }
  if (hasProjectScope && !projectId) {
    throw new Error('Project scope is required for app settings');
  }

  const row: Record<string, unknown> = {
    app_id: appId,
    key,
    value,
    updated_at: new Date().toISOString(),
  };
  if (hasProjectScope) {
    row.project_id = projectId;
  }

  const onConflict = hasProjectScope ? 'project_id,app_id,key' : 'app_id,key';
  const selectFields = hasProjectScope ? `${APP_SETTING_FIELDS}, project_id` : APP_SETTING_FIELDS;
  const { data, error } = await client
    .from('app_settings')
    .upsert(row, { onConflict })
    .select(selectFields)
    .single();

  if (error) {
    throw new Error(`Failed to set app setting: ${error.message}`);
  }

  return data as unknown as AppSetting;
}

/**
 * Delete a specific setting for an app
 */
export async function deleteAppSetting(
  appId: string,
  key: string,
  projectId?: string | null
): Promise<void> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase client not configured');
  }

  let query = client
    .from('app_settings')
    .delete()
    .eq('app_id', appId)
    .eq('key', key);
  query = (await applyProjectScopeToQuery(query, client, 'app_settings', projectId)).query;

  const { error } = await query;

  if (error) {
    throw new Error(`Failed to delete app setting: ${error.message}`);
  }
}

export async function deleteAllAppSettings(appId: string, projectId?: string | null): Promise<void> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase client not configured');
  }

  let query = client
    .from('app_settings')
    .delete()
    .eq('app_id', appId);
  query = (await applyProjectScopeToQuery(query, client, 'app_settings', projectId)).query;

  const { error } = await query;

  if (error) {
    throw new Error(`Failed to delete app settings: ${error.message}`);
  }
}
