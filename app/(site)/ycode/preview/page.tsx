import Link from 'next/link';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import { fetchHomepage, fetchErrorPage } from '@/lib/page-fetcher';
import PageRenderer from '@/components/PageRenderer';
import PasswordForm from '@/components/PasswordForm';
import { getSettingsByKeys } from '@/lib/repositories/settingsRepository';
import { generateColorVariablesCss } from '@/lib/repositories/colorVariableRepository';
import { generatePageMetadata } from '@/lib/generate-page-metadata';
import { parseAuthCookie, getPasswordProtection, fetchFoldersForAuth } from '@/lib/page-auth';
import { projectLookupFromHost, resolveNovumProjectId, resolveSingleNovumProjectIdForUser } from '@/lib/project-scope';
import { canAccessNovumProjectForUser } from '@/lib/novum-platform';
import { getAuthUser } from '@/lib/supabase-auth';
import type { Metadata } from 'next';

async function fetchPreviewDraftCss(projectId?: string | null) {
  const settings = await getSettingsByKeys(['draft_css'], projectId);
  return (settings.draft_css as string) || undefined;
}

// Force dynamic rendering - no caching for preview
export const dynamic = 'force-dynamic';
export const revalidate = 0;

type PreviewSearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

function getPreviewProjectParam(searchParams: { [key: string]: string | string[] | undefined }): string | null {
  const value = searchParams.project;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

async function getPreviewProjectLookup(searchParams: { [key: string]: string | string[] | undefined }): Promise<string | null> {
  const explicit = getPreviewProjectParam(searchParams);
  if (explicit) return explicit;

  const requestHeaders = await headers();
  const explicitHeader = requestHeaders.get('x-novum-project-slug')?.trim();
  if (explicitHeader) return explicitHeader;

  const host = requestHeaders.get('x-forwarded-host') || requestHeaders.get('host') || '';
  return projectLookupFromHost(host);
}

function buildPreviewRedirectUrl(path: string, previewProjectParam: string | null): string {
  if (!previewProjectParam) return path;
  const url = new URL(path, 'http://studio.local');
  url.searchParams.set('project', previewProjectParam);
  return `${url.pathname}${url.search}`;
}

const resolvePreviewContext = cache(async (previewProjectParam: string | null) => {
  const auth = await getAuthUser();
  const actorUserId = auth?.user?.id || null;
  if (!actorUserId) return null;

  const previewProjectId = previewProjectParam
    ? await resolveNovumProjectId(previewProjectParam)
    : await resolveSingleNovumProjectIdForUser(actorUserId);
  if (!previewProjectId) return null;
  if (!(await canAccessNovumProjectForUser(previewProjectId, actorUserId))) return null;

  const ycodeCoreProjectId = previewProjectId;
  const data = await fetchHomepage(false, undefined, undefined, undefined, undefined, ycodeCoreProjectId);
  if (!data || !data.pageLayers) {
    return {
      previewProjectParam,
      previewProjectId,
      ycodeCoreProjectId,
      data,
      draftCSS: undefined,
      colorVariablesCss: undefined,
      protection: null,
    };
  }

  const [draftCSS, colorVariablesCss, folders, authCookie] = await Promise.all([
    fetchPreviewDraftCss(ycodeCoreProjectId),
    generateColorVariablesCss(ycodeCoreProjectId),
    fetchFoldersForAuth(false, ycodeCoreProjectId),
    parseAuthCookie(),
  ]);
  const protection = getPasswordProtection(data.page, folders, authCookie);

  return {
    previewProjectParam,
    previewProjectId,
    ycodeCoreProjectId,
    data,
    draftCSS,
    colorVariablesCss,
    protection,
  };
});

export default async function Home({ searchParams }: { searchParams: PreviewSearchParams }) {
  const previewProjectParam = await getPreviewProjectLookup(await searchParams);
  const context = await resolvePreviewContext(previewProjectParam);
  if (!context) {
    notFound();
  }
  const { previewProjectId, ycodeCoreProjectId, data, draftCSS, colorVariablesCss, protection } = context;

  // If no homepage, show default landing page
  if (!data || !data.pageLayers) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
        <div className="text-center p-8">
          <h1 className="text-6xl font-bold text-gray-900 mb-4">
            Ycode Preview
          </h1>
          <p className="text-xl text-gray-600 mb-8">
            No homepage found. Create an index page in the builder.
          </p>
          <Link
            href="/ycode"
            className="inline-block bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-8 rounded-lg transition-colors"
          >
            Open Builder →
          </Link>
        </div>
      </div>
    );
  }

  // If homepage is protected and not unlocked, show 401 error page
  if (protection?.isProtected && !protection.isUnlocked) {
    const errorPageData = await fetchErrorPage(401, false, undefined, ycodeCoreProjectId);

    if (errorPageData) {
      const { page: errorPage, pageLayers: errorPageLayers, components: errorComponents } = errorPageData;

      return (
        <PageRenderer
          page={errorPage}
          layers={errorPageLayers.layers || []}
          components={errorComponents}
          generatedCss={draftCSS}
          colorVariablesCss={colorVariablesCss || undefined}
          isPreview={true}
          previewProjectParam={previewProjectParam}
          renderProjectId={ycodeCoreProjectId}
          customCodeProjectId={previewProjectId}
          passwordProtection={{
            pageId: protection.protectedBy === 'page' ? protection.protectedById : undefined,
            folderId: protection.protectedBy === 'folder' ? protection.protectedById : undefined,
            redirectUrl: buildPreviewRedirectUrl('/ycode/preview', previewProjectParam),
            isPublished: false,
          }}
        />
      );
    }

    // Inline fallback if no custom 401 page exists
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'white', fontFamily: 'system-ui, sans-serif' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 600, marginBottom: '8px', color: '#111' }}>Password Protected</h1>
        <p style={{ color: '#666', marginBottom: '24px' }}>Enter the password to continue.</p>
        <PasswordForm
          pageId={protection.protectedBy === 'page' ? protection.protectedById : undefined}
          folderId={protection.protectedBy === 'folder' ? protection.protectedById : undefined}
          redirectUrl={buildPreviewRedirectUrl('/ycode/preview', previewProjectParam)}
          isPublished={false}
        />
      </div>
    );
  }

  // Render homepage preview
  return (
    <PageRenderer
      page={data.page}
      layers={data.pageLayers.layers || []}
      components={data.components}
      generatedCss={draftCSS}
      colorVariablesCss={colorVariablesCss || undefined}
      locale={data.locale}
      availableLocales={data.availableLocales}
      isPreview={true}
      previewProjectParam={previewProjectParam}
      renderProjectId={ycodeCoreProjectId}
      customCodeProjectId={previewProjectId}
      translations={data.translations}
    />
  );
}

// Generate metadata
export async function generateMetadata({ searchParams }: { searchParams: PreviewSearchParams }): Promise<Metadata> {
  const previewProjectParam = await getPreviewProjectLookup(await searchParams);
  const context = await resolvePreviewContext(previewProjectParam);
  if (!context) {
    return {
      title: 'Preview - Page Not Found',
      robots: { index: false, follow: false },
    };
  }
  const { data, protection } = context;

  if (!data || !data.pageLayers) {
    return {
      title: 'Preview - Ycode',
      description: 'Preview - Built with Ycode',
      robots: { index: false, follow: false },
    };
  }

  if (protection?.isProtected && !protection.isUnlocked) {
    return {
      title: 'Preview - Password Protected',
      description: 'This page is password protected.',
      robots: { index: false, follow: false },
    };
  }

  return generatePageMetadata(data.page, {
    isPreview: true,
    fallbackTitle: 'Homepage',
  });
}
