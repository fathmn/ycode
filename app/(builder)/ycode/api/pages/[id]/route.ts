import { NextRequest } from 'next/server';
import {
  getPageById,
  updatePage,
  deletePage,
  deletePublishedPage,
  enrichDraftPagesWithPublishStatus,
} from '@/lib/repositories/pageRepository';
import { deleteTranslationsInBulk } from '@/lib/repositories/translationRepository';
import { getRoutePathsForPages, invalidatePages } from '@/lib/services/cacheService';
import { noCache } from '@/lib/api-response';
import { recordStudioCustomCodeMutation, requireStudioProjectRole, type StudioProjectRole } from '@/lib/studio-platform';

// Disable caching for this route
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const PAGE_READ_ROLES: StudioProjectRole[] = [
  'studio_admin',
  'studio_developer',
  'customer_owner',
  'customer_editor',
  'customer_viewer',
];
const PAGE_WRITE_ROLES: StudioProjectRole[] = [
  'studio_admin',
  'studio_developer',
  'customer_owner',
  'customer_editor',
];

/**
 * GET /ycode/api/pages/[id]
 *
 * Get a specific page
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const roleCheck = await requireStudioProjectRole(request, PAGE_READ_ROLES);
    if (!roleCheck.ok) return roleCheck.response;

    // For GET requests, return draft version (what users edit)
    const page = await getPageById(id, false, roleCheck.context.project.id);

    if (!page) {
      return noCache(
        { error: 'Page not found' },
        404
      );
    }

    return noCache({
      data: page,
    });
  } catch (error) {
    console.error('Failed to fetch page:', error);

    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to fetch page' },
      500
    );
  }
}

/**
 * PUT /ycode/api/pages/[id]
 *
 * Update a page
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const roleCheck = await requireStudioProjectRole(request, PAGE_WRITE_ROLES);
    if (!roleCheck.ok) return roleCheck.response;
    delete body.is_published;

    // Get current draft page to check its state
    // Repository update functions only update draft versions
    const currentPage = await getPageById(id, false, roleCheck.context.project.id);
    if (!currentPage) {
      return noCache(
        { error: 'Page not found' },
        404
      );
    }

    // Determine if the page is/will be an error page, index page, or dynamic page
    const isErrorPage = body.error_page !== undefined
      ? (body.error_page !== null)
      : (currentPage.error_page !== null);

    const isIndexPage = body.is_index !== undefined
      ? body.is_index
      : currentPage.is_index;

    const isDynamicPage = body.is_dynamic !== undefined
      ? body.is_dynamic
      : currentPage.is_dynamic;

    // Error pages and index pages must have empty slugs
    if (isErrorPage || isIndexPage) {
      if (body.slug !== undefined && body.slug.trim() !== '') {
        const pageType = isErrorPage ? 'Error' : 'Index';
        return noCache(
          { error: `${pageType} pages must have an empty slug` },
          400
        );
      }
      // Force slug to empty
      body.slug = '';
    }

    // Dynamic pages should have "*" as slug (allow updates to "*")
    if (isDynamicPage && body.slug !== undefined && body.slug !== '*') {
      body.slug = '*';
    }

    // The homepage and error pages must always stay live, so they can never be
    // turned into a draft regardless of what the client sends.
    const targetFolderId = body.page_folder_id !== undefined ? body.page_folder_id : currentPage.page_folder_id;
    const willBeHomepage = isIndexPage && targetFolderId === null;
    if ((isErrorPage || willBeHomepage) && body.is_publishable === false) {
      body.is_publishable = true;
    }

    // Detect a live -> draft transition so we can unpublish in the same request
    const isUnpublishing = body.is_publishable === false && currentPage.is_publishable !== false;

    // Pass all updates to the repository (it will handle further validation)
    const page = await updatePage(id, body, roleCheck.context.project.id);

    if (body.settings?.custom_code) {
      await recordStudioCustomCodeMutation(request, {
        scope: 'page',
        targetId: id,
        content: JSON.stringify(body.settings.custom_code),
        metadata: {
          route: '/ycode/api/pages/[id]',
          pageId: id,
          fields: Object.keys(body.settings.custom_code),
        },
      });
    }

    // When a page becomes a draft, remove its live version and purge its cache.
    // Routes are resolved before deletion so the stale URLs can be invalidated.
    if (isUnpublishing) {
      let routes: string[] = [];
      try {
        routes = await getRoutePathsForPages([id]);
      } catch {
        // Non-fatal: route resolution failure should not block the update
      }

      await deletePublishedPage(id);

      if (routes.length > 0) {
        try {
          await invalidatePages(routes);
        } catch {
          // Non-fatal
        }
      }
    }

    // Return the page with computed publish status for the builder listing
    const [enriched] = await enrichDraftPagesWithPublishStatus([page]);

    return noCache({
      data: enriched ?? page,
    });
  } catch (error) {
    console.error('Failed to update page:', error);

    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to update page' },
      500
    );
  }
}

/**
 * DELETE /ycode/api/pages/[id]
 *
 * Delete a page and its associated translations
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const roleCheck = await requireStudioProjectRole(request, PAGE_WRITE_ROLES);
    if (!roleCheck.ok) return roleCheck.response;

    // Delete the page
    await deletePage(id, roleCheck.context.project.id);

    // Delete all translations for this page
    await deleteTranslationsInBulk('page', id);

    return noCache({
      success: true,
      message: 'Page deleted successfully',
    });
  } catch (error) {
    console.error('Failed to delete page:', error);

    // Foreign or missing pages surface as "Page not found" from the scoped
    // repository lookup — that is a 404, not a server error.
    if (error instanceof Error && error.message === 'Page not found') {
      return noCache({ error: 'Page not found' }, 404);
    }

    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to delete page' },
      500
    );
  }
}
