import { unstable_cache } from 'next/cache';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import PublishedPageRenderer from '@/components/PublishedPageRenderer';
import PasswordForm from '@/components/PasswordForm';
import { generatePageMetadata } from '@/lib/generate-page-metadata';
import { parseAuthCookie, getPasswordProtection } from '@/lib/page-auth';
import { resolvePublishedProjectFromHeaders } from '@/lib/published-project';
import {
  buildPublishedDataCacheKey,
  buildPublishedDataCacheTags,
  fetchCachedPublishedErrorPage,
  fetchCachedPublishedFoldersForAuth,
  fetchCachedPublishedGlobalSettings,
  fetchCachedPublishedHomepage,
  getPublishedPageDataLocale,
} from '@/lib/server/publishedPageDataCache';
import { getSiteBaseUrl } from '@/lib/url-utils';
import { STUDIO_BASE_PATH } from '@/lib/brand';
import type { Metadata } from 'next';

// Public pages resolve the Studio project from the request host and cache the
// fetched project data below with explicit revalidation tags.
export const revalidate = false;

export default async function Home() {
  const { projectId, unresolvedHost } = await resolvePublishedProjectFromHeaders();
  if (unresolvedHost) notFound();
  const authCookie = await parseAuthCookie();
  // Cache-first homepage path; pagination is served through internal dynamic routes.
  const data = await fetchCachedPublishedHomepage(projectId);

  // If no published homepage exists, show default landing page
  if (!data || !data.pageLayers) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-center p-8 flex flex-col items-center justify-center gap-2">
          <h1 className="text-xl font-semibold text-neutral-900">
            Willkommen im Studio
          </h1>
          <Link
            href={STUDIO_BASE_PATH}
            className=" bg-blue-500 text-white text-sm font-medium h-8 flex items-center justify-center px-3 rounded-lg transition-colors"
          >
            Studio öffnen
          </Link>
        </div>
      </div>
    );
  }

  // Load all global settings early so error pages also get global custom code
  const globalSettings = await fetchCachedPublishedGlobalSettings(projectId);

  // Check password protection for homepage.
  // First evaluate without cookies() so non-protected pages can stay cacheable.
  const folders = await fetchCachedPublishedFoldersForAuth(projectId);
  const protectionCheck = getPasswordProtection(data.page, folders, null);

  // If homepage is protected, read auth cookie and re-check unlock state.
  if (protectionCheck.isProtected) {
    const protection = getPasswordProtection(data.page, folders, authCookie);

    // If homepage is protected and not unlocked, show 401 error page
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
            publishedRoutePath="/"
            passwordProtection={{
              pageId: protection.protectedBy === 'page' ? protection.protectedById : undefined,
              folderId: protection.protectedBy === 'folder' ? protection.protectedById : undefined,
              redirectUrl: '/',
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
              redirectUrl="/"
              isPublished={true}
            />
          </div>
        </div>
      );
    }
  }

  // Render homepage
  return (
    <PublishedPageRenderer
      page={data.page}
      layers={data.pageLayers.layers || []}
      components={data.components}
      generatedCss={data.generatedCss || globalSettings.publishedCss || undefined}
      colorVariablesCss={globalSettings.colorVariablesCss || undefined}
      locale={data.locale}
      availableLocales={data.availableLocales}
      translations={data.translations}
      gaMeasurementId={globalSettings.gaMeasurementId}
      globalCustomCodeHead={globalSettings.globalCustomCodeHead}
      globalCustomCodeBody={globalSettings.globalCustomCodeBody}
      ycodeBadge={globalSettings.ycodeBadge}
      renderProjectId={projectId}
      customCodeProjectId={projectId}
      publishedRoutePath="/"
    />
  );
}

// Generate metadata
export async function generateMetadata(): Promise<Metadata> {
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
    fetchCachedPublishedHomepage(projectId),
    fetchCachedPublishedGlobalSettings(projectId),
  ]);

  if (!data) {
    return {
      title: 'Studio',
      description: 'Kundenstudio für Websites',
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
        fallbackTitle: 'Home',
        pagePath: '/',
        globalSeoSettings: globalSettings,
      }),
      baseUrl: getSiteBaseUrl({ globalCanonicalUrl: globalSettings.globalCanonicalUrl }),
    }),
    buildPublishedDataCacheKey({
      projectId,
      routePath: '/',
      pageId: data.page.id,
      locale: getPublishedPageDataLocale(data),
      scope: 'metadata',
    }),
    { tags: buildPublishedDataCacheTags(projectId, '/'), revalidate: false }
  )();

  if (baseUrl) {
    try { meta.metadataBase = new URL(baseUrl); } catch { /* invalid URL */ }
  }

  return meta;
}
