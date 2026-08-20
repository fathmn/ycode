import { notFound, redirect, permanentRedirect } from 'next/navigation';
import { unstable_cache } from 'next/cache';
import type { Metadata } from 'next';
import { generatePageMetadata } from '@/lib/generate-page-metadata';
import PublishedPageRenderer from '@/components/PublishedPageRenderer';
import PasswordForm from '@/components/PasswordForm';
import { parseAuthCookie, getPasswordProtection } from '@/lib/page-auth';
import { resolvePublishedProjectFromHeaders } from '@/lib/published-project';
import {
  buildPublishedDataCacheKey,
  buildPublishedDataCacheTags,
  fetchCachedPublishedErrorPage,
  fetchCachedPublishedFoldersForAuth,
  fetchCachedPublishedGlobalSettings,
  fetchCachedPublishedPage,
  fetchCachedPublishedRedirects,
  getPublishedPageDataLocale,
} from '@/lib/server/publishedPageDataCache';
import { getSiteBaseUrl } from '@/lib/url-utils';

// Public pages resolve the Studio project from the request host and cache the
// fetched project data below with explicit revalidation tags.
export const revalidate = false;
export const dynamicParams = true;

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
  const authCookie = await parseAuthCookie();

  // Check for redirects before processing the page
  const currentPath = `/${slugPath}`;
  const redirects = await fetchCachedPublishedRedirects(projectId);
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
  const data = await fetchCachedPublishedPage(slugPath, projectId);

  // Load all global settings early so error pages also get global custom code
  const globalSettings = await fetchCachedPublishedGlobalSettings(projectId);

  // If page not found, try to show custom 404 error page
  if (!data) {
    const errorPageData = await fetchCachedPublishedErrorPage(404, projectId);

    if (errorPageData) {
      const { page: errorPage, pageLayers: errorPageLayers, components: errorComponents } = errorPageData;

      return (
        <PublishedPageRenderer
          page={errorPage}
          layers={errorPageLayers.layers || []}
          components={errorComponents}
          generatedCss={errorPageData.generatedCss || globalSettings.publishedCss || undefined}
          globalCustomCodeHead={globalSettings.globalCustomCodeHead}
          globalCustomCodeBody={globalSettings.globalCustomCodeBody}
          renderProjectId={projectId}
          customCodeProjectId={projectId}
          publishedRoutePath={currentPath}
        />
      );
    }

    // No custom 404 page, use default Next.js 404
    notFound();
  }

  const { page, pageLayers, components, collectionItem, collectionFields, pageCollectionSortedItemIds, pageCollectionSortedItemSlugs, locale, availableLocales, translations } = data;

  // Check password protection for this page.
  // First evaluate without cookies() so non-protected pages stay cacheable.
  const folders = await fetchCachedPublishedFoldersForAuth(projectId);
  const protectionCheck = getPasswordProtection(page, folders, null);

  // If page is protected, read auth cookie and re-check unlock state.
  if (protectionCheck.isProtected) {
    const protection = getPasswordProtection(page, folders, authCookie);

    // If page is protected and not unlocked, show 401 error page
    if (!protection.isUnlocked) {
      const errorPageData = await fetchCachedPublishedErrorPage(401, projectId);

      if (errorPageData) {
        const { page: errorPage, pageLayers: errorPageLayers, components: errorComponents } = errorPageData;

        return (
          <PublishedPageRenderer
            page={errorPage}
            layers={errorPageLayers.layers || []}
            components={errorComponents}
            generatedCss={errorPageData.generatedCss || globalSettings.publishedCss || undefined}
            globalCustomCodeHead={globalSettings.globalCustomCodeHead}
            globalCustomCodeBody={globalSettings.globalCustomCodeBody}
            renderProjectId={projectId}
            customCodeProjectId={projectId}
            publishedRoutePath={currentPath}
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
      generatedCss={data.generatedCss || globalSettings.publishedCss || undefined}
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
      publishedRoutePath={currentPath}
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
  const authCookie = await parseAuthCookie();

  // Fetch page and global settings in parallel
  const [data, globalSettings] = await Promise.all([
    fetchCachedPublishedPage(slugPath, projectId),
    fetchCachedPublishedGlobalSettings(projectId),
  ]);

  if (!data) {
    return {
      title: 'Page Not Found',
    };
  }

  // Check password protection - don't leak metadata for protected pages.
  // First check without cookies() to avoid forcing dynamic metadata for public pages.
  const folders = await fetchCachedPublishedFoldersForAuth(projectId);
  const protectionCheck = getPasswordProtection(data.page, folders, null);

  if (protectionCheck.isProtected) {
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
    buildPublishedDataCacheKey({
      projectId,
      routePath: `/${slugPath}`,
      pageId: data.page.id,
      locale: getPublishedPageDataLocale(data),
      scope: 'metadata',
    }),
    { tags: buildPublishedDataCacheTags(projectId, `/${slugPath}`), revalidate: false }
  )();

  if (baseUrl) {
    try { meta.metadataBase = new URL(baseUrl); } catch { /* invalid URL */ }
  }

  return meta;
}
