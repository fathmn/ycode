import { getSupabaseAdmin } from '@/lib/supabase-server';
import {
  applyProjectScopeToQuery,
  resolveProjectScopeForWrite,
  tableHasProjectScopeColumn,
} from '@/lib/project-scope';
import { createHash, randomBytes } from 'crypto';
import { invalidateToken } from '@/lib/mcp/token-cache';

export interface McpToken {
  id: string;
  name: string;
  token_prefix: string;
  project_id?: string | null;
  is_active: boolean;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
  oauth_client_id: string | null;
  expires_at: string | null;
  user_id: string | null;
}

export interface McpTokenWithPlainToken extends McpToken {
  token: string;
}

export interface OAuthTokenPair {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  refresh_expires_in: number;
}

export interface CreateOAuthTokenData {
  user_id: string;
  oauth_client_id: string;
  name: string;
  access_token_ttl_seconds?: number;
  refresh_token_ttl_seconds?: number;
}

const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 60 * 60; // 1 hour
const DEFAULT_REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

function generateToken(): string {
  return 'ymc_' + randomBytes(24).toString('hex');
}

function generateRefreshToken(): string {
  return 'ymr_' + randomBytes(32).toString('hex');
}

/**
 * Hash a refresh token with SHA-256 before storing. We only ever hand the
 * plaintext value back to the OAuth client once at issue time; the database
 * keeps the hash so a DB leak can't be replayed against `/oauth/token`.
 */
function hashRefreshToken(refreshToken: string): string {
  return createHash('sha256').update(refreshToken).digest('hex');
}

const MCP_TOKEN_FIELDS = 'id, name, token_prefix, project_id, is_active, last_used_at, created_at, updated_at, oauth_client_id, expires_at, user_id';
const MCP_TOKEN_WITH_SECRET_FIELDS = 'id, name, token, token_prefix, project_id, is_active, last_used_at, created_at, updated_at, oauth_client_id, expires_at, user_id';
const MCP_TOKEN_FIELDS_UNSCOPED = 'id, name, token_prefix, is_active, last_used_at, created_at, updated_at, oauth_client_id, expires_at, user_id';
const MCP_TOKEN_WITH_SECRET_FIELDS_UNSCOPED = 'id, name, token, token_prefix, is_active, last_used_at, created_at, updated_at, oauth_client_id, expires_at, user_id';

async function getTokenSelectFields(client: any, includeSecret = false): Promise<string> {
  const hasProjectScope = await tableHasProjectScopeColumn(client, 'mcp_tokens');
  if (includeSecret) return hasProjectScope ? MCP_TOKEN_WITH_SECRET_FIELDS : MCP_TOKEN_WITH_SECRET_FIELDS_UNSCOPED;
  return hasProjectScope ? MCP_TOKEN_FIELDS : MCP_TOKEN_FIELDS_UNSCOPED;
}

export async function getAllTokens(projectId?: string | null): Promise<McpToken[]> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase not configured');
  }

  let query = (client.from('mcp_tokens') as any)
    .select(await getTokenSelectFields(client));
  query = (await applyProjectScopeToQuery(query, client, 'mcp_tokens', projectId)).query;

  const { data, error } = await query.order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch MCP tokens: ${error.message}`);
  }

  return (data || []) as McpToken[];
}

export async function createToken(
  name: string,
  projectId?: string | null,
  userId?: string | null
): Promise<McpTokenWithPlainToken> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase not configured');
  }

  if (!projectId) {
    throw new Error('MCP tokens must be bound to a project');
  }

  const token = generateToken();
  const tokenPrefix = token.substring(0, 12);
  const hasProjectScope = await resolveProjectScopeForWrite(client, 'mcp_tokens', projectId);
  if (!hasProjectScope) {
    throw new Error('MCP token project scope column is required');
  }

  const { data, error } = await (client.from('mcp_tokens') as any)
    .insert({
      name,
      token,
      token_prefix: tokenPrefix,
      project_id: projectId,
      ...(userId ? { user_id: userId } : {}),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select(await getTokenSelectFields(client, true))
    .single();

  if (error) {
    throw new Error(`Failed to create MCP token: ${error.message}`);
  }

  return data as McpTokenWithPlainToken;
}

/**
 * Validate a token and return the record if active and not expired.
 * Updates last_used_at in the background.
 */
export async function validateToken(token: string): Promise<McpToken | null> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase not configured');
  }

  const hasProjectScope = await tableHasProjectScopeColumn(client, 'mcp_tokens');
  if (!hasProjectScope) {
    return null;
  }

  const { data, error } = await (client.from('mcp_tokens') as any)
    .select(await getTokenSelectFields(client))
    .eq('token', token)
    .eq('is_active', true)
    .single();

  if (error || !data) {
    return null;
  }

  if (!data.project_id) {
    return null;
  }

  if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) {
    return null;
  }

  let updateQuery = (client.from('mcp_tokens') as any)
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', data.id);
  if (hasProjectScope && data.project_id) {
    updateQuery = updateQuery.eq('project_id', data.project_id);
  }
  await updateQuery;

  return data as McpToken;
}

export async function deleteToken(id: string, projectId?: string | null): Promise<void> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase not configured');
  }

  let existingQuery = (client.from('mcp_tokens') as any)
    .select('token')
    .eq('id', id);
  existingQuery = (await applyProjectScopeToQuery(existingQuery, client, 'mcp_tokens', projectId)).query;
  const { data: existing } = await existingQuery.single();

  let query = (client.from('mcp_tokens') as any)
    .delete()
    .eq('id', id);
  query = (await applyProjectScopeToQuery(query, client, 'mcp_tokens', projectId)).query;

  const { error } = await query;

  if (error) {
    throw new Error(`Failed to delete MCP token: ${error.message}`);
  }

  if (existing?.token) {
    invalidateToken(existing.token);
  }
}

export async function getTokenById(id: string, projectId?: string | null): Promise<McpToken | null> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase not configured');
  }

  let query = (client.from('mcp_tokens') as any)
    .select(await getTokenSelectFields(client))
    .eq('id', id);
  query = (await applyProjectScopeToQuery(query, client, 'mcp_tokens', projectId)).query;

  const { data, error } = await query.single();

  if (error && error.code !== 'PGRST116') {
    throw new Error(`Failed to fetch MCP token: ${error.message}`);
  }

  return data as McpToken | null;
}

/**
 * Issue an OAuth-bound MCP token pair (access + refresh).
 * Both tokens are random opaque strings stored alongside their TTLs.
 */
export async function createOAuthToken(
  data: CreateOAuthTokenData,
  projectId?: string | null,
): Promise<OAuthTokenPair> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase not configured');
  }

  if (!projectId) {
    throw new Error('MCP tokens must be bound to a project');
  }

  const hasProjectScope = await resolveProjectScopeForWrite(client, 'mcp_tokens', projectId);
  if (!hasProjectScope) {
    throw new Error('MCP token project scope column is required');
  }

  const accessTtl = data.access_token_ttl_seconds ?? DEFAULT_ACCESS_TOKEN_TTL_SECONDS;
  const refreshTtl = data.refresh_token_ttl_seconds ?? DEFAULT_REFRESH_TOKEN_TTL_SECONDS;

  const token = generateToken();
  const refreshToken = generateRefreshToken();
  const now = Date.now();
  const expiresAt = new Date(now + accessTtl * 1000).toISOString();
  const refreshExpiresAt = new Date(now + refreshTtl * 1000).toISOString();
  const tokenPrefix = token.substring(0, 12);

  const { error } = await (client.from('mcp_tokens') as any)
    .insert({
      name: data.name,
      token,
      token_prefix: tokenPrefix,
      project_id: projectId,
      oauth_client_id: data.oauth_client_id,
      user_id: data.user_id,
      expires_at: expiresAt,
      refresh_token_hash: hashRefreshToken(refreshToken),
      refresh_expires_at: refreshExpiresAt,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

  if (error) {
    throw new Error(`Failed to create OAuth MCP token: ${error.message}`);
  }

  return {
    access_token: token,
    refresh_token: refreshToken,
    expires_in: accessTtl,
    refresh_expires_in: refreshTtl,
  };
}

/**
 * Rotate a refresh token: validate the old one, issue a fresh access+refresh
 * pair, and revoke the old token row. Returns null if the refresh token is
 * unknown, revoked, expired, or not bound to a project.
 */
export async function rotateRefreshToken(
  refreshToken: string,
  options?: { access_token_ttl_seconds?: number; refresh_token_ttl_seconds?: number },
  projectId?: string | null,
): Promise<OAuthTokenPair | null> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase not configured');
  }

  const hasProjectScope = await tableHasProjectScopeColumn(client, 'mcp_tokens');
  if (!hasProjectScope) {
    return null;
  }

  let fetchQuery = (client.from('mcp_tokens') as any)
    .select('id, name, token, project_id, oauth_client_id, user_id, refresh_expires_at, is_active')
    .eq('refresh_token_hash', hashRefreshToken(refreshToken))
    .eq('is_active', true);
  fetchQuery = (await applyProjectScopeToQuery(fetchQuery, client, 'mcp_tokens', projectId)).query;
  const { data: existing, error: fetchError } = await fetchQuery.single();

  if (fetchError || !existing) {
    return null;
  }

  // Reject tokens that are not bound to a project — they can never validate.
  if (!existing.project_id) {
    return null;
  }

  if (!existing.refresh_expires_at
      || new Date(existing.refresh_expires_at).getTime() < Date.now()) {
    return null;
  }

  if (!existing.oauth_client_id || !existing.user_id) {
    return null;
  }

  // Revoke the old token first so a leaked refresh token can't be reused.
  await (client.from('mcp_tokens') as any)
    .delete()
    .eq('id', existing.id)
    .eq('project_id', existing.project_id);
  if (existing.token) {
    invalidateToken(existing.token);
  }

  return createOAuthToken({
    user_id: existing.user_id,
    oauth_client_id: existing.oauth_client_id,
    name: existing.name,
    access_token_ttl_seconds: options?.access_token_ttl_seconds,
    refresh_token_ttl_seconds: options?.refresh_token_ttl_seconds,
  }, existing.project_id);
}
