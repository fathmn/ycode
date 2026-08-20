import 'server-only';

import { cache } from 'react';
import { unstable_cache } from 'next/cache';
import { fetchGlobalPageSettings } from '@/lib/generate-page-metadata';
import {
  fetchErrorPage,
  fetchHomepage,
  fetchPageByPath,
  reassemblePageData,
  slimPageData,
  splitPageData,
  type PageData,
  type PageDataCore,
} from '@/lib/page-fetcher';
import { fetchFoldersForAuth } from '@/lib/page-auth';
import { getAllLocales } from '@/lib/repositories/localeRepository';
import { getSettingByKey } from '@/lib/repositories/settingsRepository';
import type { Layer, Redirect as RedirectType } from '@/types';

const PUBLISHED_CACHE_VERSION = 'published-data-v2';
const PUBLISHED_STATE = 'published';
// Keep every encoded data entry comfortably below Vercel's 2 MB Data Cache
// limit. Base64 makes the serialized entry size predictable even when rich
// text contains many quotes or escape sequences.
const PUBLISHED_DATA_CHUNK_CHARACTERS = 768 * 1024;

type PublishedDataPart = 'core' | 'layers';

type PublishedDataManifest = {
  found: boolean;
  chunkCount: number;
  encodedCharacters: number;
  firstChunk?: string;
};

function projectCacheKey(projectId: string | null): string {
  return projectId || 'global';
}

export function normalizePublishedRoutePath(routePath: string): string {
  const normalized = `/${routePath}`.replace(/\/{2,}/g, '/');
  return normalized.length > 1 ? normalized.replace(/\/$/, '') : normalized;
}

export function getPublishedPageDataLocale(data: Pick<PageData, 'locale' | 'availableLocales'>): string {
  return data.locale?.code
    || data.availableLocales?.find((locale) => locale.is_default)?.code
    || 'default';
}

export function buildPublishedDataCacheKey(input: {
  projectId: string | null;
  routePath: string;
  locale: string;
  scope: string;
  pageId?: string;
  part?: string;
}): string[] {
  return [
    PUBLISHED_CACHE_VERSION,
    `project:${projectCacheKey(input.projectId)}`,
    `route:${normalizePublishedRoutePath(input.routePath)}`,
    `page:${input.pageId || 'route'}`,
    `locale:${input.locale || 'default'}`,
    `state:${PUBLISHED_STATE}`,
    `scope:${input.scope}`,
    `part:${input.part || 'all'}`,
  ];
}

export function buildPublishedDataCacheTags(
  projectId: string | null,
  routePath?: string,
): string[] {
  const tags = ['all-pages', `project-${projectCacheKey(projectId)}`];
  if (routePath) tags.push(`route-${normalizePublishedRoutePath(routePath)}`);
  return tags;
}

const fetchPublishedHomepageForRequest = cache(async (projectId: string | null) => (
  fetchHomepage(true, undefined, undefined, undefined, undefined, projectId)
));

const fetchPublishedPageForRequest = cache(async (slugPath: string, projectId: string | null) => (
  fetchPageByPath(slugPath, true, undefined, undefined, projectId)
));

async function fetchCachedPublishedLocales(projectId: string | null) {
  return unstable_cache(
    async () => getAllLocales(true, projectId),
    buildPublishedDataCacheKey({
      projectId,
      routePath: '/',
      locale: 'all',
      scope: 'locale-index',
    }),
    { tags: buildPublishedDataCacheTags(projectId), revalidate: false },
  )();
}

async function resolvePublishedRouteLocale(slugPath: string, projectId: string | null): Promise<string> {
  try {
    const locales = await fetchCachedPublishedLocales(projectId);
    const firstSegment = slugPath.split('/').filter(Boolean)[0]?.toLowerCase();
    const explicitLocale = firstSegment
      ? locales.find((locale) => locale.code.toLowerCase() === firstSegment)
      : undefined;
    const defaultLocale = locales.find((locale) => locale.is_default);
    return explicitLocale?.code.toLowerCase() || defaultLocale?.code.toLowerCase() || 'default';
  } catch {
    return 'default';
  }
}

async function fetchSplitPublishedPageData(
  routePath: string,
  locale: string,
  projectId: string | null,
  fetchData: () => Promise<PageData | null>,
): Promise<PageData | null> {
  const tags = buildPublishedDataCacheTags(projectId, routePath);
  const commonKey = {
    projectId,
    routePath,
    locale,
    scope: 'page-data',
  };

  const getEncodedPartForRequest = cache(async (part: PublishedDataPart): Promise<string | null> => {
    const data = await fetchData();
    if (!data) return null;
    return Buffer.from(JSON.stringify(splitPageData(data)[part]), 'utf8').toString('base64');
  });

  async function fetchCachedPart<T>(part: PublishedDataPart): Promise<T | null> {
    const manifest = await unstable_cache(
      async () => {
        const encoded = await getEncodedPartForRequest(part);
        if (encoded === null) {
          return {
            found: false,
            chunkCount: 0,
            encodedCharacters: 0,
          } satisfies PublishedDataManifest;
        }

        return {
          found: true,
          chunkCount: Math.max(1, Math.ceil(encoded.length / PUBLISHED_DATA_CHUNK_CHARACTERS)),
          encodedCharacters: encoded.length,
          firstChunk: encoded.slice(0, PUBLISHED_DATA_CHUNK_CHARACTERS),
        } satisfies PublishedDataManifest;
      },
      buildPublishedDataCacheKey({ ...commonKey, part: `${part}-manifest` }),
      { tags, revalidate: false },
    )();

    if (!manifest.found || !manifest.firstChunk) return null;

    const remainingChunks = await Promise.all(
      Array.from({ length: manifest.chunkCount - 1 }, (_, offset) => {
        const chunkIndex = offset + 1;
        return unstable_cache(
          async () => {
            const encoded = await getEncodedPartForRequest(part);
            if (encoded === null) {
              throw new Error(`Published ${part} disappeared while populating cache chunks`);
            }
            const start = chunkIndex * PUBLISHED_DATA_CHUNK_CHARACTERS;
            return encoded.slice(start, start + PUBLISHED_DATA_CHUNK_CHARACTERS);
          },
          buildPublishedDataCacheKey({ ...commonKey, part: `${part}-chunk-${chunkIndex}` }),
          { tags, revalidate: false },
        )();
      }),
    );
    const encoded = [manifest.firstChunk, ...remainingChunks].join('');
    if (encoded.length !== manifest.encodedCharacters) {
      throw new Error(
        `Published ${part} cache was incomplete (${encoded.length}/${manifest.encodedCharacters} encoded characters)`,
      );
    }
    return JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) as T;
  }

  try {
    const [core, layers] = await Promise.all([
      fetchCachedPart<PageDataCore>('core'),
      fetchCachedPart<Layer[]>('layers'),
    ]);

    if (!core) return null;
    return reassemblePageData(core, layers || []);
  } catch (error) {
    // Keep rendering if a cache entry fails, but make the miss observable. The
    // route and split sizes are safe diagnostics; no page content is logged.
    const data = await fetchData();
    if (!data) return null;
    const slimmed = slimPageData(data);
    const split = splitPageData(slimmed);
    console.warn('[published-page-cache] Falling back to fresh PageData', {
      route: normalizePublishedRoutePath(routePath),
      projectId: projectCacheKey(projectId),
      coreBytes: Buffer.byteLength(JSON.stringify(split.core), 'utf8'),
      layersBytes: Buffer.byteLength(JSON.stringify(split.layers), 'utf8'),
      error: error instanceof Error ? error.message : String(error),
    });
    return slimmed;
  }
}

export async function fetchCachedPublishedHomepage(projectId: string | null): Promise<PageData | null> {
  const locale = await resolvePublishedRouteLocale('', projectId);
  return fetchSplitPublishedPageData(
    '/',
    locale,
    projectId,
    async () => (await fetchPublishedHomepageForRequest(projectId)) as PageData | null,
  );
}

export async function fetchCachedPublishedPage(slugPath: string, projectId: string | null): Promise<PageData | null> {
  const routePath = normalizePublishedRoutePath(slugPath);
  const locale = await resolvePublishedRouteLocale(slugPath, projectId);
  return fetchSplitPublishedPageData(
    routePath,
    locale,
    projectId,
    () => fetchPublishedPageForRequest(slugPath, projectId),
  );
}

export async function fetchCachedPublishedRedirects(projectId: string | null): Promise<RedirectType[] | null> {
  try {
    return await unstable_cache(
      async () => getSettingByKey('redirects', projectId) as Promise<RedirectType[] | null>,
      buildPublishedDataCacheKey({
        projectId,
        routePath: '/',
        locale: 'all',
        scope: 'redirects',
      }),
      { tags: buildPublishedDataCacheTags(projectId), revalidate: false },
    )();
  } catch {
    return null;
  }
}

export function defaultPublishedGlobalSettings() {
  return {
    googleSiteVerification: null,
    globalCanonicalUrl: null,
    gaMeasurementId: null,
    publishedCss: null,
    colorVariablesCss: null,
    globalCustomCodeHead: null,
    globalCustomCodeBody: null,
    ycodeBadge: false,
    faviconUrl: null,
    webClipUrl: null,
  };
}

export async function fetchCachedPublishedGlobalSettings(projectId: string | null) {
  try {
    return await unstable_cache(
      async () => fetchGlobalPageSettings(false, projectId),
      buildPublishedDataCacheKey({
        projectId,
        routePath: '/',
        locale: 'all',
        scope: 'global-settings',
      }),
      { tags: buildPublishedDataCacheTags(projectId), revalidate: false },
    )();
  } catch {
    return defaultPublishedGlobalSettings();
  }
}

export async function fetchCachedPublishedFoldersForAuth(projectId: string | null) {
  try {
    return await unstable_cache(
      async () => fetchFoldersForAuth(true, projectId),
      buildPublishedDataCacheKey({
        projectId,
        routePath: '/',
        locale: 'all',
        scope: 'auth-folders',
      }),
      { tags: buildPublishedDataCacheTags(projectId), revalidate: false },
    )();
  } catch {
    return [];
  }
}

export async function fetchCachedPublishedErrorPage(
  errorCode: 401 | 404,
  projectId: string | null,
) {
  try {
    return await unstable_cache(
      async () => {
        const data = await fetchErrorPage(errorCode, true, undefined, projectId);
        return data ? slimPageData(data) : null;
      },
      buildPublishedDataCacheKey({
        projectId,
        routePath: `/error/${errorCode}`,
        locale: 'all',
        scope: 'error-page',
        pageId: `error-${errorCode}`,
      }),
      { tags: buildPublishedDataCacheTags(projectId), revalidate: false },
    )();
  } catch {
    return null;
  }
}
