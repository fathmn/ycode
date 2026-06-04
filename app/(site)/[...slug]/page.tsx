import { notFound, redirect, permanentRedirect } from 'next/navigation';
import { unstable_cache } from 'next/cache';
import type { Metadata } from 'next';
import { generatePageMetadata, fetchGlobalPageSettings } from '@/lib/generate-page-metadata';
import { fetchPageByPath, fetchErrorPage } from '@/lib/page-fetcher';
import PublishedPageRenderer from '@/components/PublishedPageRenderer';
import PasswordForm from '@/components/PasswordForm';
import { getSettingByKey } from '@/lib/repositories/settingsRepository';
import { parseAuthCookie, getPasswordProtection, fetchFoldersForAuth } from '@/lib/page-auth';
import { resolvePublishedProjectFromHeaders } from '@/lib/published-project';
import { getSiteBaseUrl } from '@/lib/url-utils';
import type { Page, Redirect as RedirectType } from '@/types';

// Public pages resolve the Studio project from the request host and cache the
// fetched project data below with explicit revalidation tags. The route must
// stay dynamic because host-based project resolution uses request headers; the
// public CDN cache policy is applied in proxy.ts.
export const dynamic = 'force-dynamic';
export const revalidate = false;
export const dynamicParams = true;

export async function generateStaticParams() {
  return [];
}

/**
 * Fetch published page and layers data from database
 * Cached per slug and page for revalidation
 */
async function fetchPublishedPageWithLayers(slugPath: string, projectId: string | null) {
  const projectCacheKey = projectId || 'global';
  try {
    return await unstable_cache(
      async () => fetchPageByPath(slugPath, true, undefined, undefined, projectId),
      [`data-for-project-${projectCacheKey}-route-/${slugPath}`],
      {
        tags: ['all-pages', `project-${projectCacheKey}`, `route-/${slugPath}`],
        revalidate: false,
      }
    )();
  } catch {
    // Fallback to uncached fetch when data exceeds cache size limit (2MB).
    // If runtime credentials are unavailable (e.g. build-time), return null.
    try {
      return await fetchPageByPath(slugPath, true, undefined, undefined, projectId);
    } catch {
      return null;
    }
  }
}

async function fetchCachedRedirects(projectId: string | null): Promise<RedirectType[] | null> {
  const projectCacheKey = projectId || 'global';
  try {
    return await unstable_cache(
      async () => getSettingByKey('redirects', projectId) as Promise<RedirectType[] | null>,
      [`data-for-project-${projectCacheKey}-redirects`],
      { tags: ['all-pages', `project-${projectCacheKey}`], revalidate: false }
    )();
  } catch {
    return null;
  }
}

async function fetchCachedGlobalSettings(projectId: string | null) {
  const projectCacheKey = projectId || 'global';
  try {
    return await unstable_cache(
      async () => fetchGlobalPageSettings(projectId),
      [`data-for-project-${projectCacheKey}-global-settings`],
      { tags: ['all-pages', `project-${projectCacheKey}`], revalidate: false }
    )();
  } catch {
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
}

async function fetchCachedFoldersForAuth(projectId: string | null) {
  const projectCacheKey = projectId || 'global';
  try {
    return await unstable_cache(
      async () => fetchFoldersForAuth(true, projectId),
      [`data-for-project-${projectCacheKey}-auth-folders`],
      { tags: ['all-pages', `project-${projectCacheKey}`], revalidate: false }
    )();
  } catch {
    return [];
  }
}

async function fetchCachedErrorPage(errorCode: 401 | 404, projectId: string | null) {
  const projectCacheKey = projectId || 'global';
  try {
    return await unstable_cache(
      async () => fetchErrorPage(errorCode, true, undefined, projectId),
      [`data-for-project-${projectCacheKey}-error-page-${errorCode}`],
      { tags: ['all-pages', `project-${projectCacheKey}`], revalidate: false }
    )();
  } catch {
    return null;
  }
}

interface PageProps {
  params: Promise<{ slug: string | string[] }>;
}

export default async function Page({ params }: PageProps) {
  // Await params
  const { slug } = await params;

  // Handle catch-all slug (join array into path)
  const slugPath = Array.isArray(slug) ? slug.join('/') : slug;
  const { projectId, unresolvedHost } = await resolvePublishedProjectFromHeaders();
  if (unresolvedHost) notFound();

  // Check for redirects before processing the page
  const currentPath = `/${slugPath}`;
  const redirects = await fetchCachedRedirects(projectId);
  if (redirects && Array.isArray(redirects)) {
    const matchedRedirect = redirects.find((r) => r.oldUrl === currentPath);
    if (matchedRedirect) {
      // Use permanentRedirect for 301 (default), redirect for 302
      if (matchedRedirect.type === '302') {
        redirect(matchedRedirect.newUrl);
      } else {
        permanentRedirect(matchedRedirect.newUrl);
      }
    }
  }

  // Cache-first slug path; pagination is served through internal dynamic routes.
  const data = await fetchPublishedPageWithLayers(slugPath, projectId);

  // Load all global settings early so error pages also get global custom code
  const globalSettings = await fetchCachedGlobalSettings(projectId);

  // If page not found, try to show custom 404 error page
  if (!data) {
    const errorPageData = await fetchCachedErrorPage(404, projectId);

    if (errorPageData) {
      const { page: errorPage, pageLayers: errorPageLayers, components: errorComponents } = errorPageData;

      return (
        <PublishedPageRenderer
          page={errorPage}
          layers={errorPageLayers.layers || []}
          components={errorComponents}
          generatedCss={globalSettings.publishedCss || undefined}
          globalCustomCodeHead={globalSettings.globalCustomCodeHead}
          globalCustomCodeBody={globalSettings.globalCustomCodeBody}
          renderProjectId={projectId}
          customCodeProjectId={projectId}
        />
      );
    }

    // No custom 404 page, use default Next.js 404
    notFound();
  }

  const { page, pageLayers, components, collectionItem, collectionFields, pageCollectionSortedItemIds, pageCollectionSortedItemSlugs, locale, availableLocales, translations } = data;

  // Check password protection for this page.
  // First evaluate without cookies() so non-protected pages stay cacheable.
  const folders = await fetchCachedFoldersForAuth(projectId);
  const protectionCheck = getPasswordProtection(page, folders, null);

  // If page is protected, read auth cookie and re-check unlock state.
  if (protectionCheck.isProtected) {
    const authCookie = await parseAuthCookie();
    const protection = getPasswordProtection(page, folders, authCookie);

    // If page is protected and not unlocked, show 401 error page
    if (!protection.isUnlocked) {
      const errorPageData = await fetchCachedErrorPage(401, projectId);

      if (errorPageData) {
        const { page: errorPage, pageLayers: errorPageLayers, components: errorComponents } = errorPageData;

        return (
          <PublishedPageRenderer
            page={errorPage}
            layers={errorPageLayers.layers || []}
            components={errorComponents}
            generatedCss={globalSettings.publishedCss || undefined}
            globalCustomCodeHead={globalSettings.globalCustomCodeHead}
            globalCustomCodeBody={globalSettings.globalCustomCodeBody}
            renderProjectId={projectId}
            customCodeProjectId={projectId}
            passwordProtection={{
              pageId: protection.protectedBy === 'page' ? protection.protectedById : undefined,
              folderId: protection.protectedBy === 'folder' ? protection.protectedById : undefined,
              redirectUrl: currentPath,
              isPublished: true,
            }}
          />
        );
      }

      // Inline fallback if no custom 401 page exists
      return (
        <div className="min-h-screen flex items-center justify-center bg-white">
          <div className="text-center max-w-md px-4">
            <h1 className="text-6xl font-bold text-gray-900 mb-4">401</h1>
            <h2 className="text-2xl font-semibold text-gray-800 mb-4">Password Protected</h2>
            <p className="text-gray-600 mb-8">Enter the password to continue.</p>
            <PasswordForm
              pageId={protection.protectedBy === 'page' ? protection.protectedById : undefined}
              folderId={protection.protectedBy === 'folder' ? protection.protectedById : undefined}
              redirectUrl={currentPath}
              isPublished={true}
            />
          </div>
        </div>
      );
    }
  }

  return (
    <PublishedPageRenderer
      page={page}
      layers={pageLayers.layers || []}
      components={components}
      generatedCss={globalSettings.publishedCss || undefined}
      colorVariablesCss={globalSettings.colorVariablesCss || undefined}
      collectionItem={collectionItem}
      collectionFields={collectionFields}
      pageCollectionSortedItemIds={pageCollectionSortedItemIds}
      pageCollectionSortedItemSlugs={pageCollectionSortedItemSlugs}
      locale={locale}
      availableLocales={availableLocales}
      translations={translations}
      gaMeasurementId={globalSettings.gaMeasurementId}
      globalCustomCodeHead={globalSettings.globalCustomCodeHead}
      globalCustomCodeBody={globalSettings.globalCustomCodeBody}
      ycodeBadge={globalSettings.ycodeBadge}
      renderProjectId={projectId}
      customCodeProjectId={projectId}
    />
  );
}

// Generate metadata
export async function generateMetadata({ params }: { params: Promise<{ slug: string | string[] }> }): Promise<Metadata> {
  const { slug } = await params;

  // Handle catch-all slug (join array into path)
  const slugPath = Array.isArray(slug) ? slug.join('/') : slug;
  const { projectId, unresolvedHost } = await resolvePublishedProjectFromHeaders();
  if (unresolvedHost) {
    return {
      title: 'Page Not Found',
      robots: { index: false, follow: false },
    };
  }

  // Fetch page and global settings in parallel
  const [data, globalSettings] = await Promise.all([
    fetchPublishedPageWithLayers(slugPath, projectId),
    fetchCachedGlobalSettings(projectId),
  ]);

  if (!data) {
    return {
      title: 'Page Not Found',
    };
  }

  // Check password protection - don't leak metadata for protected pages.
  // First check without cookies() to avoid forcing dynamic metadata for public pages.
  const folders = await fetchCachedFoldersForAuth(projectId);
  const protectionCheck = getPasswordProtection(data.page, folders, null);

  if (protectionCheck.isProtected) {
    const authCookie = await parseAuthCookie();
    const protection = getPasswordProtection(data.page, folders, authCookie);
    if (!protection.isUnlocked) {
      return {
        title: 'Password Protected',
        description: 'This page is password protected.',
        robots: { index: false, follow: false },
      };
    }
  }

  const { meta, baseUrl } = await unstable_cache(
    async () => ({
      meta: await generatePageMetadata(data.page, {
        fallbackTitle: slugPath.charAt(0).toUpperCase() + slugPath.slice(1),
        collectionItem: data.collectionItem,
        pagePath: '/' + slugPath,
        globalSeoSettings: globalSettings,
      }),
      baseUrl: getSiteBaseUrl({ globalCanonicalUrl: globalSettings.globalCanonicalUrl }),
    }),
    [`data-for-project-${projectId || 'global'}-route-/${slugPath}-meta`],
    { tags: ['all-pages', `project-${projectId || 'global'}`, `route-/${slugPath}`], revalidate: false }
  )();

  if (baseUrl) {
    try { meta.metadataBase = new URL(baseUrl); } catch { /* invalid URL */ }
  }

  return meta;
}
