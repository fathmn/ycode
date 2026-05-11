import PageRenderer from '@/components/PageRenderer';
import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import { fetchErrorPage } from '@/lib/page-fetcher';
import { getSettingsByKeys } from '@/lib/repositories/settingsRepository';
import { generateColorVariablesCss } from '@/lib/repositories/colorVariableRepository';
import { generatePageMetadata } from '@/lib/generate-page-metadata';
import { projectLookupFromHost, resolveNovumProjectId, resolveSingleNovumProjectIdForCurrentUser } from '@/lib/project-scope';
import { canAccessNovumProject } from '@/lib/novum-platform';
import type { Metadata } from 'next';

async function fetchPreviewDraftCss(projectId?: string | null) {
  const settings = await getSettingsByKeys(['draft_css'], projectId);
  return (settings.draft_css as string) || undefined;
}

interface ErrorPagePreviewProps {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

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

/**
 * Preview route for error pages
 * Accessible at /ycode/preview/error-pages/404, /ycode/preview/error-pages/500, etc.
 */
export default async function ErrorPagePreview({ params, searchParams }: ErrorPagePreviewProps) {
  const { code } = await params;
  const errorCode = parseInt(code, 10);
  const previewProjectParam = await getPreviewProjectLookup(await searchParams);
  const previewProjectId = previewProjectParam
    ? await resolveNovumProjectId(previewProjectParam)
    : await resolveSingleNovumProjectIdForCurrentUser();
  if (!previewProjectId) {
    notFound();
  }
  if (!(await canAccessNovumProject(previewProjectId))) {
    notFound();
  }
  const ycodeCoreProjectId = previewProjectId;

  // Fetch the error page (draft version for preview)
  const pageData = await fetchErrorPage(errorCode, false, undefined, ycodeCoreProjectId);

  if (!pageData) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-center max-w-md px-4">
          <h1 className="text-2xl font-bold text-gray-900 mb-3">
            Invalid error page
          </h1>
          <p className="text-gray-600 mb-6">
            The {errorCode} error page cannot be customized.
          </p>
        </div>
      </div>
    );
  }

  const { page, pageLayers, components, locale, availableLocales, translations } = pageData;

  // Fetch draft CSS and color variables
  const [draftCSS, colorVariablesCss] = await Promise.all([
    fetchPreviewDraftCss(ycodeCoreProjectId),
    generateColorVariablesCss(ycodeCoreProjectId),
  ]);

  return (
    <PageRenderer
      page={page}
      layers={pageLayers.layers || []}
      components={components}
      generatedCss={draftCSS}
      colorVariablesCss={colorVariablesCss || undefined}
      locale={locale}
      availableLocales={availableLocales}
      isPreview={true}
      previewProjectParam={previewProjectParam}
      renderProjectId={ycodeCoreProjectId}
      customCodeProjectId={previewProjectId}
      translations={translations}
    />
  );
}

// Generate metadata
export async function generateMetadata({ params, searchParams }: ErrorPagePreviewProps): Promise<Metadata> {
  const { code } = await params;
  const errorCode = parseInt(code, 10);
  const previewProjectParam = await getPreviewProjectLookup(await searchParams);
  const previewProjectId = previewProjectParam
    ? await resolveNovumProjectId(previewProjectParam)
    : await resolveSingleNovumProjectIdForCurrentUser();
  if (!previewProjectId) {
    return {
      title: `[Preview] ${errorCode} error page`,
      description: `Preview of ${errorCode} error page`,
      robots: { index: false, follow: false },
    };
  }
  if (!(await canAccessNovumProject(previewProjectId))) {
    return {
      title: `[Preview] ${errorCode} error page`,
      description: `Preview of ${errorCode} error page`,
      robots: { index: false, follow: false },
    };
  }

  // Fetch error page to get SEO settings
  const ycodeCoreProjectId = previewProjectId;
  const pageData = await fetchErrorPage(errorCode, false, undefined, ycodeCoreProjectId);

  if (!pageData) {
    return {
      title: `[Preview] ${errorCode} error page`,
      description: `Preview of ${errorCode} error page`,
      robots: { index: false, follow: false },
    };
  }

  return generatePageMetadata(pageData.page, {
    isPreview: true,
  });
}
