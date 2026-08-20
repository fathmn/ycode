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
} from '@/lib/page-fetcher';
import { fetchFoldersForAuth } from '@/lib/page-auth';
import { getAllLocales } from '@/lib/repositories/localeRepository';
import { getSettingByKey } from '@/lib/repositories/settingsRepository';
import type { Redirect as RedirectType } from '@/types';

const PUBLISHED_CACHE_VERSION = 'published-data-v1';
const PUBLISHED_STATE = 'published';

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

  try {
    const [core, layers] = await Promise.all([
      unstable_cache(
        async () => {
          const data = await fetchData();
          return data ? splitPageData(data).core : null;
        },
        buildPublishedDataCacheKey({ ...commonKey, part: 'core' }),
        { tags, revalidate: false },
      )(),
      unstable_cache(
        async () => {
          const data = await fetchData();
          return data ? splitPageData(data).layers : null;
        },
        buildPublishedDataCacheKey({ ...commonKey, part: 'layers' }),
        { tags, revalidate: false },
      )(),
    ]);

    if (!core) return null;
    return reassemblePageData(core, layers || []);
  } catch {
    // Keep rendering if either half still exceeds Next's 2 MB per-entry limit.
    // The request-level React cache prevents this fallback from repeating the DB work.
    const data = await fetchData();
    return data ? slimPageData(data) : null;
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
