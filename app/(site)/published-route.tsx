import { unstable_cache } from 'next/cache';
import Link from 'next/link';
import { notFound, redirect, permanentRedirect } from 'next/navigation';
import type { Metadata } from 'next';
import { generatePageMetadata, fetchGlobalPageSettings } from '@/lib/generate-page-metadata';
import { fetchHomepage, fetchPageByPath, fetchErrorPage } from '@/lib/page-fetcher';
import PublishedPageRenderer from '@/components/PublishedPageRenderer';
import PasswordForm from '@/components/PasswordForm';
import { getSettingByKey } from '@/lib/repositories/settingsRepository';
import { parseAuthCookie, getPasswordProtection, fetchFoldersForAuth } from '@/lib/page-auth';
import { getSiteBaseUrl } from '@/lib/url-utils';
import type { Redirect as RedirectType } from '@/types';

function defaultGlobalSettings() {
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

async function fetchPublishedHomepage(projectId: string | null) {
  const projectCacheKey = projectId || 'global';
  try {
    return await unstable_cache(
      async () => fetchHomepage(true, undefined, undefined, undefined, undefined, projectId),
      [`data-for-project-${projectCacheKey}-route-/`],
      {
        tags: ['all-pages', `project-${projectCacheKey}`, 'route-/'],
        revalidate: false,
      }
    )();
  } catch {
    try {
      return await fetchHomepage(true, undefined, undefined, undefined, undefined, projectId);
    } catch {
      return null;
    }
  }
}

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
      async () => fetchGlobalPageSettings(false, projectId),
      [`data-for-project-${projectCacheKey}-global-settings`],
      { tags: ['all-pages', `project-${projectCacheKey}`], revalidate: false }
    )();
  } catch {
    return defaultGlobalSettings();
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
          href="/ycode"
          className=" bg-blue-500 text-white text-sm font-medium h-8 flex items-center justify-center px-3 rounded-lg transition-colors"
        >
          Studio öffnen
        </Link>
      </div>
    </div>
  );
}

async function renderProtectedErrorPage(projectId: string | null, globalSettings: Awaited<ReturnType<typeof fetchCachedGlobalSettings>>, currentPath: string, protection: {
  protectedBy?: 'page' | 'folder';
  protectedById?: string;
}) {
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

  return renderPasswordFallback(protection, currentPath);
}

export async function renderPublishedHome(projectId: string | null) {
  const data = await fetchPublishedHomepage(projectId);

  if (!data || !data.pageLayers) {
    return renderDefaultLanding();
  }

  const globalSettings = await fetchCachedGlobalSettings(projectId);
  const folders = await fetchCachedFoldersForAuth(projectId);
  const protectionCheck = getPasswordProtection(data.page, folders, null);

  if (protectionCheck.isProtected) {
    const authCookie = await parseAuthCookie();
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
      generatedCss={globalSettings.publishedCss || undefined}
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
    />
  );
}

export async function renderPublishedSlug(slugPath: string, projectId: string | null) {
  const currentPath = `/${slugPath}`;
  const redirects = await fetchCachedRedirects(projectId);
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

  const data = await fetchPublishedPageWithLayers(slugPath, projectId);
  const globalSettings = await fetchCachedGlobalSettings(projectId);

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

    notFound();
  }

  const { page, pageLayers, components, collectionItem, collectionFields, pageCollectionSortedItemIds, pageCollectionSortedItemSlugs, locale, availableLocales, translations } = data;
  const folders = await fetchCachedFoldersForAuth(projectId);
  const protectionCheck = getPasswordProtection(page, folders, null);

  if (protectionCheck.isProtected) {
    const authCookie = await parseAuthCookie();
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

export async function generatePublishedHomeMetadata(projectId: string | null): Promise<Metadata> {
  const [data, globalSettings] = await Promise.all([
    fetchPublishedHomepage(projectId),
    fetchCachedGlobalSettings(projectId),
  ]);

  if (!data) {
    return {
      title: 'Studio',
      description: 'Kundenstudio für Websites',
    };
  }

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
        fallbackTitle: 'Home',
        pagePath: '/',
        globalSeoSettings: globalSettings,
      }),
      baseUrl: getSiteBaseUrl({ globalCanonicalUrl: globalSettings.globalCanonicalUrl }),
    }),
    [`data-for-project-${projectId || 'global'}-route-/-meta`],
    { tags: ['all-pages', `project-${projectId || 'global'}`, 'route-/'], revalidate: false }
  )();

  if (baseUrl) {
    try { meta.metadataBase = new URL(baseUrl); } catch { /* invalid URL */ }
  }

  return meta;
}

export async function generatePublishedSlugMetadata(slugPath: string, projectId: string | null): Promise<Metadata> {
  const [data, globalSettings] = await Promise.all([
    fetchPublishedPageWithLayers(slugPath, projectId),
    fetchCachedGlobalSettings(projectId),
  ]);

  if (!data) {
    return {
      title: 'Page Not Found',
    };
  }

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
        pagePath: `/${slugPath}`,
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
