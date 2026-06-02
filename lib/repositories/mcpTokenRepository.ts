import { getSupabaseAdmin } from '@/lib/supabase-server';
import {
  applyProjectScopeToQuery,
  resolveProjectScopeForWrite,
  tableHasProjectScopeColumn,
} from '@/lib/project-scope';
import { randomBytes } from 'crypto';

export interface McpToken {
  id: string;
  name: string;
  token_prefix: string;
  project_id?: string | null;
  is_active: boolean;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface McpTokenWithPlainToken extends McpToken {
  token: string;
}

function generateToken(): string {
  return 'ymc_' + randomBytes(24).toString('hex');
}

const MCP_TOKEN_FIELDS = 'id, name, token_prefix, project_id, is_active, last_used_at, created_at, updated_at';
const MCP_TOKEN_WITH_SECRET_FIELDS = 'id, name, token, token_prefix, project_id, is_active, last_used_at, created_at, updated_at';
const MCP_TOKEN_FIELDS_UNSCOPED = 'id, name, token_prefix, is_active, last_used_at, created_at, updated_at';
const MCP_TOKEN_WITH_SECRET_FIELDS_UNSCOPED = 'id, name, token, token_prefix, is_active, last_used_at, created_at, updated_at';

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

export async function createToken(name: string, projectId?: string | null): Promise<McpTokenWithPlainToken> {
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
 * Validate a token and return the record if active.
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

  let query = (client.from('mcp_tokens') as any)
    .delete()
    .eq('id', id);
  query = (await applyProjectScopeToQuery(query, client, 'mcp_tokens', projectId)).query;

  const { error } = await query;

  if (error) {
    throw new Error(`Failed to delete MCP token: ${error.message}`);
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
