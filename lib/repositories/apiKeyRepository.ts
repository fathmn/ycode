import { getSupabaseAdmin } from '@/lib/supabase-server';
import {
  applyProjectScopeToQuery,
  isSharedDbProjectScopeRequired,
  tableHasProjectScopeColumn,
} from '@/lib/project-scope';
import { createHash, randomBytes } from 'crypto';

/**
 * API Key Repository
 *
 * Handles CRUD operations for API keys used in the public v1 API.
 * Keys are stored as SHA-256 hashes for security.
 */

export interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  last_used_at: string | null;
  project_id?: string | null;
  created_at: string;
  updated_at: string;
}

const API_KEY_FIELDS = 'id, name, key_prefix, last_used_at, created_at, updated_at';

async function apiKeySelectFields(client: any): Promise<string> {
  return (await tableHasProjectScopeColumn(client, 'api_keys'))
    ? `${API_KEY_FIELDS}, project_id`
    : API_KEY_FIELDS;
}

export interface ApiKeyWithPlainKey extends ApiKey {
  api_key: string; // Only returned once during creation
}

/**
 * Hash an API key using SHA-256
 */
export function hashApiKey(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex');
}

/**
 * Generate a new API key
 * Format: 64 random hex chars
 */
function generateApiKey(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Get all API keys (without hashes)
 */
export async function getAllApiKeys(projectId?: string | null): Promise<ApiKey[]> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase client not configured');
  }

  const selectFields = await apiKeySelectFields(client);
  let query = client
    .from('api_keys')
    .select(selectFields)
    .order('created_at', { ascending: false });
  query = (await applyProjectScopeToQuery(query, client, 'api_keys', projectId)).query;

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to fetch API keys: ${error.message}`);
  }

  return (data || []) as unknown as ApiKey[];
}

/**
 * Create a new API key
 * Returns the key info including the plain key (shown only once)
 */
export async function createApiKey(
  name: string,
  projectId?: string | null
): Promise<ApiKeyWithPlainKey> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase client not configured');
  }

  // Generate the key
  const apiKey = generateApiKey();
  const keyHash = hashApiKey(apiKey);
  const keyPrefix = apiKey.substring(0, 8); // First 8 chars for identification

  const hasProjectScope = await tableHasProjectScopeColumn(client, 'api_keys');
  if (!hasProjectScope && isSharedDbProjectScopeRequired()) {
    throw new Error('Project scope column is required for API keys');
  }
  if (hasProjectScope && !projectId) {
    throw new Error('Project scope is required for API keys');
  }

  const row: Record<string, any> = {
    name,
    key_hash: keyHash,
    key_prefix: keyPrefix,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (hasProjectScope) {
    row.project_id = projectId;
  }

  const selectFields = hasProjectScope ? `${API_KEY_FIELDS}, project_id` : API_KEY_FIELDS;
  const { data, error } = await client
    .from('api_keys')
    .insert(row)
    .select(selectFields)
    .single();

  if (error) {
    throw new Error(`Failed to create API key: ${error.message}`);
  }

  return {
    ...(data as unknown as ApiKey),
    api_key: apiKey, // Return plain key only on creation
  };
}

/**
 * Delete an API key
 */
export async function deleteApiKey(
  id: string,
  projectId?: string | null
): Promise<void> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase client not configured');
  }

  let query = client
    .from('api_keys')
    .delete()
    .eq('id', id);
  query = (await applyProjectScopeToQuery(query, client, 'api_keys', projectId)).query;

  const { error } = await query;

  if (error) {
    throw new Error(`Failed to delete API key: ${error.message}`);
  }
}

/**
 * Validate an API key
 * Returns the key record if valid, null otherwise
 * Also updates last_used_at timestamp
 */
export async function validateApiKey(apiKey: string): Promise<ApiKey | null> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase client not configured');
  }

  const keyHash = hashApiKey(apiKey);
  const hasProjectScope = await tableHasProjectScopeColumn(client, 'api_keys');
  if (!hasProjectScope && isSharedDbProjectScopeRequired()) {
    return null;
  }

  // Find the key by hash
  const selectFields = hasProjectScope ? `${API_KEY_FIELDS}, project_id` : API_KEY_FIELDS;
  const { data, error } = await client
    .from('api_keys')
    .select(selectFields)
    .eq('key_hash', keyHash)
    .single();

  if (error || !data) {
    return null;
  }
  const key = data as unknown as ApiKey;
  if (hasProjectScope && !key.project_id && isSharedDbProjectScopeRequired()) {
    return null;
  }

  // Update last_used_at (fire and forget - don't wait for it)
  (async () => {
    try {
      await client
        .from('api_keys')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', key.id);
    } catch (err) {
      console.error('Failed to update last_used_at:', err);
    }
  })();

  return key;
}

/**
 * Get an API key by ID (without hash)
 */
export async function getApiKeyById(
  id: string,
  projectId?: string | null
): Promise<ApiKey | null> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase client not configured');
  }

  const selectFields = await apiKeySelectFields(client);
  let query = client
    .from('api_keys')
    .select(selectFields)
    .eq('id', id);
  query = (await applyProjectScopeToQuery(query, client, 'api_keys', projectId)).query;

  const { data, error } = await query.single();

  if (error && error.code !== 'PGRST116') {
    throw new Error(`Failed to fetch API key: ${error.message}`);
  }

  return (data as ApiKey | null);
}
