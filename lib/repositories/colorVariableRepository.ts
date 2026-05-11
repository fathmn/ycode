/**
 * Color Variable Repository
 *
 * Data access layer for color variable operations with Supabase.
 * Color variables are site-wide design tokens stored as CSS custom properties.
 */

import { getSupabaseAdmin } from '@/lib/supabase-server';
import { applyProjectScopeToQuery } from '@/lib/project-scope';
import type { ColorVariable } from '@/types';

export interface CreateColorVariableData {
  name: string;
  value: string;
}

export interface UpdateColorVariableData {
  name?: string;
  value?: string;
}

/**
 * Convert a stored color value (#hex or #hex/opacity) to a CSS-ready value.
 */
function toCssValue(val: string): string {
  const trimmed = val.trim();
  if (!isSafeColorValue(trimmed)) return '';
  const parts = trimmed.split('/');
  if (parts.length < 2) return trimmed;
  const hex = parts[0];
  const opacity = parseInt(parts[1]) / 100;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${opacity})`;
}

function isSafeColorVariableId(value: string): boolean {
  return /^[a-zA-Z0-9_-]{1,128}$/.test(value);
}

function isSafeColorValue(value: string): boolean {
  if (/</.test(value) || /\/\*|\*\//.test(value) || /url\s*\(|@import|expression\s*\(/i.test(value)) return false;
  return (
    /^#[0-9a-f]{3,8}(?:\/(?:100|[1-9]?\d))?$/i.test(value)
    || /^rgba?\(\s*(?:\d{1,3}\s*,\s*){2}\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/i.test(value)
    || /^hsla?\(\s*\d{1,3}(?:deg)?\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/i.test(value)
    || /^(transparent|currentColor)$/i.test(value)
  );
}

function escapeStyleBoundary(value: string): string {
  return value.replace(/<\/style/gi, '<\\/style');
}

/**
 * Generate a `:root { ... }` CSS string with all color variable declarations.
 * Returns null if no variables exist.
 */
export async function generateColorVariablesCss(projectId?: string | null): Promise<string | null> {
  try {
    const colorVars = await getAllColorVariables(projectId);
    if (colorVars.length === 0) return null;
    const declarations = colorVars
      .map((v) => {
        if (!isSafeColorVariableId(v.id)) return null;
        const cssValue = toCssValue(v.value);
        return cssValue ? `--${v.id}: ${cssValue};` : null;
      })
      .filter((declaration): declaration is string => Boolean(declaration))
      .join(' ');
    if (!declarations) return null;
    return escapeStyleBoundary(`:root { ${declarations} }`);
  } catch {
    return null;
  }
}

export async function getAllColorVariables(projectId?: string | null): Promise<ColorVariable[]> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase not configured');
  }

  let query = client
    .from('color_variables')
    .select('*');
  query = (await applyProjectScopeToQuery(query, client, 'color_variables', projectId)).query;
  const { data, error } = await query
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch color variables: ${error.message}`);
  }

  return data || [];
}

export async function getColorVariableById(id: string): Promise<ColorVariable | null> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase not configured');
  }

  const { data, error } = await client
    .from('color_variables')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    throw new Error(`Failed to fetch color variable: ${error.message}`);
  }

  return data;
}

export async function createColorVariable(
  variableData: CreateColorVariableData
): Promise<ColorVariable> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase not configured');
  }

  // Get max sort_order to append at end
  const { data: maxRow } = await client
    .from('color_variables')
    .select('sort_order')
    .order('sort_order', { ascending: false })
    .limit(1)
    .single();
  const nextOrder = (maxRow?.sort_order ?? -1) + 1;

  const { data, error } = await client
    .from('color_variables')
    .insert({ ...variableData, sort_order: nextOrder })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create color variable: ${error.message}`);
  }

  return data;
}

export async function updateColorVariable(
  id: string,
  updates: UpdateColorVariableData
): Promise<ColorVariable> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase not configured');
  }

  const { data, error } = await client
    .from('color_variables')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update color variable: ${error.message}`);
  }

  return data;
}

export async function deleteColorVariable(id: string): Promise<void> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase not configured');
  }

  const { error } = await client
    .from('color_variables')
    .delete()
    .eq('id', id);

  if (error) {
    throw new Error(`Failed to delete color variable: ${error.message}`);
  }
}

export async function reorderColorVariables(
  orderedIds: string[]
): Promise<void> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase not configured');
  }

  // Fetch full rows so upsert includes all NOT NULL columns
  const { data: existing, error: fetchError } = await client
    .from('color_variables')
    .select('*')
    .in('id', orderedIds);

  if (fetchError) {
    throw new Error(`Failed to fetch color variables for reorder: ${fetchError.message}`);
  }

  const existingMap = new Map((existing || []).map((v) => [v.id, v]));
  const now = new Date().toISOString();

  const updates = orderedIds
    .map((id, index) => {
      const row = existingMap.get(id);
      if (!row) return null;
      return { ...row, sort_order: index, updated_at: now };
    })
    .filter(Boolean);

  const { error } = await client
    .from('color_variables')
    .upsert(updates, { onConflict: 'id' });

  if (error) {
    throw new Error(`Failed to reorder color variables: ${error.message}`);
  }
}
