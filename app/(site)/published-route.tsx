import { unstable_cache } from 'next/cache';
import Link from 'next/link';
import { notFound, redirect, permanentRedirect } from 'next/navigation';
import type { Metadata } from 'next';
import { generatePageMetadata } from '@/lib/generate-page-metadata';
import PublishedPageRenderer from '@/components/PublishedPageRenderer';
import PasswordForm from '@/components/PasswordForm';
import { parseAuthCookie, getPasswordProtection } from '@/lib/page-auth';
import {
  buildPublishedDataCacheKey,
  buildPublishedDataCacheTags,
  fetchCachedPublishedErrorPage,
  fetchCachedPublishedFoldersForAuth,
  fetchCachedPublishedGlobalSettings,
  fetchCachedPublishedHomepage,
  fetchCachedPublishedPage,
  fetchCachedPublishedRedirects,
  getPublishedPageDataLocale,
} from '@/lib/server/publishedPageDataCache';
import { getSiteBaseUrl } from '@/lib/url-utils';
import { STUDIO_BASE_PATH } from '@/lib/brand';

function renderPasswordFallback(protection: {
  protectedBy?: 'page' | 'folder';
  protectedById?: string;
}, redirectUrl: string) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="text-center max-w-md px-4">
        <h1 className="text-6xl font-bold text-gray-900 mb-4">401</h1>
        <h2 className="text-2xl font-semibold text-gray-800 mb-4">Password Protected</h2>
        <p className="text-gray-600 mb-8">Enter the password to continue.</p>
        <PasswordForm
          pageId={protection.protectedBy === 'page' ? protection.protectedById : undefined}
          folderId={protection.protectedBy === 'folder' ? protection.protectedById : undefined}
          redirectUrl={redirectUrl}
          isPublished={true}
        />
      </div>
    </div>
  );
}

function renderDefaultLanding() {
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

async function renderProtectedErrorPage(projectId: string | null, globalSettings: Awaited<ReturnType<typeof fetchCachedPublishedGlobalSettings>>, currentPath: string, protection: {
  protectedBy?: 'page' | 'folder';
  protectedById?: string;
}) {
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

  return renderPasswordFallback(protection, currentPath);
}

export async function renderPublishedHome(projectId: string | null) {
  const authCookie = await parseAuthCookie();
  const data = await fetchCachedPublishedHomepage(projectId);

  if (!data || !data.pageLayers) {
    return renderDefaultLanding();
  }

  const globalSettings = await fetchCachedPublishedGlobalSettings(projectId);
  const folders = await fetchCachedPublishedFoldersForAuth(projectId);
  const protectionCheck = getPasswordProtection(data.page, folders, null);

  if (protectionCheck.isProtected) {
    const protection = getPasswordProtection(data.page, folders, authCookie);

    if (!protection.isUnlocked) {
      return renderProtectedErrorPage(projectId, globalSettings, '/', protection);
    }
  }

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

export async function renderPublishedSlug(slugPath: string, projectId: string | null) {
  const currentPath = `/${slugPath}`;
  const authCookie = await parseAuthCookie();
  const redirects = await fetchCachedPublishedRedirects(projectId);
  if (redirects && Array.isArray(redirects)) {
    const matchedRedirect = redirects.find((r) => r.oldUrl === currentPath);
    if (matchedRedirect) {
      if (matchedRedirect.type === '302') {
        redirect(matchedRedirect.newUrl);
      } else {
        permanentRedirect(matchedRedirect.newUrl);
      }
    }
  }

  const data = await fetchCachedPublishedPage(slugPath, projectId);
  const globalSettings = await fetchCachedPublishedGlobalSettings(projectId);

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

    notFound();
  }

  const { page, pageLayers, components, collectionItem, collectionFields, pageCollectionSortedItemIds, pageCollectionSortedItemSlugs, locale, availableLocales, translations } = data;
  const folders = await fetchCachedPublishedFoldersForAuth(projectId);
  const protectionCheck = getPasswordProtection(page, folders, null);

  if (protectionCheck.isProtected) {
    const protection = getPasswordProtection(page, folders, authCookie);

    if (!protection.isUnlocked) {
      return renderProtectedErrorPage(projectId, globalSettings, currentPath, protection);
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

export async function generatePublishedHomeMetadata(projectId: string | null): Promise<Metadata> {
  const authCookie = await parseAuthCookie();
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

  const folders = await fetchCachedPublishedFoldersForAuth(projectId);
  const protectionCheck = getPasswordProtection(data.page, folders, null);

  if (protectionCheck.isProtected) {
    const protection = getPasswordProtection(data.page, folders, authCookie);
    if (!protection.isUnlocked) {
      return {
        // German-facing Studio: the gate is what visitors see in the browser
        // tab and in link previews, so it must not read like an error.
        title: 'Im Aufbau',
        description: 'Diese Seite ist passwortgeschützt.',
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

export async function generatePublishedSlugMetadata(slugPath: string, projectId: string | null): Promise<Metadata> {
  const authCookie = await parseAuthCookie();
  const [data, globalSettings] = await Promise.all([
    fetchCachedPublishedPage(slugPath, projectId),
    fetchCachedPublishedGlobalSettings(projectId),
  ]);

  if (!data) {
    return {
      title: 'Page Not Found',
    };
  }

  const folders = await fetchCachedPublishedFoldersForAuth(projectId);
  const protectionCheck = getPasswordProtection(data.page, folders, null);

  if (protectionCheck.isProtected) {
    const protection = getPasswordProtection(data.page, folders, authCookie);
    if (!protection.isUnlocked) {
      return {
        // German-facing Studio: the gate is what visitors see in the browser
        // tab and in link previews, so it must not read like an error.
        title: 'Im Aufbau',
        description: 'Diese Seite ist passwortgeschützt.',
        robots: { index: false, follow: false },
      };
    }
  }

  const { meta, baseUrl } = await unstable_cache(
    async () => ({
      meta: await generatePageMetadata(data.page, {
        fallbackTitle: slugPath.charAt(0).toUpperCase() + slugPath.slice(1),
        collectionItem: data.collectionItem,
        pagePath: `/${slugPath}`,
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
