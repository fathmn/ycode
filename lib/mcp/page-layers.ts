/**
 * Cached read/write helpers for page layers used by MCP tools.
 *
 * Agents typically make 10-50 sequential tool calls against the same page. The
 * naive `getDraftLayers` → `upsertDraftLayers` pattern hits Supabase twice per
 * call (once for the tool's read, once inside the repo's write). This module
 * collapses both:
 *
 *   1. Reads are cached per page on `globalThis` with a short TTL. Subsequent
 *      reads inside a burst skip the DB entirely. The TTL is short enough that
 *      builder-side edits resync within a few seconds.
 *
 *   2. Writes pass the cached `PageLayers` row to `upsertDraftLayers` via its
 *      `existingDraft` parameter, so the repo skips its own internal read.
 *      The repo's translation diff still runs against the cached snapshot.
 *
 * On any write error we evict the page from the cache so the next read pulls
 * fresh data from the DB.
 */

import type { Layer, PageLayers } from '@/types';
import {
  getDraftLayers,
  upsertDraftLayers,
} from '@/lib/repositories/pageLayersRepository';
import { broadcastLayersChanged } from '@/lib/mcp/broadcast';

interface CacheEntry {
  pageLayers: PageLayers;
  expiresAt: number;
}

const CACHE_TTL_MS = 5_000;

const globalForPageCache = globalThis as unknown as {
  __mcpPageLayersCache?: Map<string, CacheEntry>;
};

const cache = globalForPageCache.__mcpPageLayersCache ?? new Map<string, CacheEntry>();
globalForPageCache.__mcpPageLayersCache = cache;

function isFresh(entry: CacheEntry | undefined): entry is CacheEntry {
  return entry !== undefined && entry.expiresAt > Date.now();
}

// Studio: cache entries are keyed per project so multi-tenant MCP sessions can
// never serve another project's draft from the shared in-memory cache.
function cacheKey(pageId: string, projectId?: string | null): string {
  return `${projectId ?? 'default'}:${pageId}`;
}

/**
 * Fetch the draft `PageLayers` row for a page, served from the in-memory cache
 * when fresh. Returns `null` if no draft exists.
 */
export async function getCachedDraft(pageId: string, projectId?: string | null): Promise<PageLayers | null> {
  const key = cacheKey(pageId, projectId);
  const cached = cache.get(key);
  if (isFresh(cached)) {
    return cached.pageLayers;
  }

  const draft = await getDraftLayers(pageId, projectId);
  if (draft) {
    cache.set(key, { pageLayers: draft, expiresAt: Date.now() + CACHE_TTL_MS });
  } else {
    cache.delete(key);
  }
  return draft;
}

/**
 * Convenience: return just the layer tree (or `[]` if no draft).
 */
export async function getCachedLayers(pageId: string, projectId?: string | null): Promise<Layer[]> {
  const draft = await getCachedDraft(pageId, projectId);
  return (draft?.layers as Layer[]) || [];
}

/**
 * Save layers for a page and update the cache. Passes the cached `PageLayers`
 * snapshot to `upsertDraftLayers` so the repo skips its own pre-read.
 *
 * On error the cache entry is invalidated so the next read is forced to hit
 * the database.
 */
export async function saveCachedLayers(pageId: string, layers: Layer[], projectId?: string | null): Promise<PageLayers> {
  const key = cacheKey(pageId, projectId);
  const cached = cache.get(key);
  const existingDraft = isFresh(cached) ? cached.pageLayers : undefined;

  let saved: PageLayers;
  try {
    saved = await upsertDraftLayers(pageId, layers, undefined, existingDraft, projectId);
  } catch (error) {
    cache.delete(key);
    throw error;
  }

  cache.set(key, { pageLayers: saved, expiresAt: Date.now() + CACHE_TTL_MS });
  broadcastLayersChanged(pageId, layers).catch(() => {});
  return saved;
}

/**
 * Drop the cached entry for a page. Use after operations that change the page
 * outside this module's awareness (e.g. publishing, deleting).
 */
export function invalidateCachedPage(pageId: string, projectId?: string | null): void {
  if (projectId !== undefined) {
    cache.delete(cacheKey(pageId, projectId));
    return;
  }
  // No project given: evict the page across all projects.
  for (const key of cache.keys()) {
    if (key.endsWith(`:${pageId}`)) {
      cache.delete(key);
    }
  }
}
