import { NextRequest, NextResponse } from 'next/server';
import { getAllCollections, createCollection } from '@/lib/repositories/collectionRepository';
import { noCache } from '@/lib/api-response';
import { requireStudioProjectRole, type StudioProjectRole } from '@/lib/studio-platform';

const STUDIO_READ_ROLES: StudioProjectRole[] = [
  'studio_admin',
  'studio_developer',
  'customer_owner',
  'customer_editor',
  'customer_viewer',
];
const STUDIO_WRITE_ROLES: StudioProjectRole[] = [
  'studio_admin',
  'studio_developer',
  'customer_owner',
  'customer_editor',
];

// Disable caching for this route
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /ycode/api/collections
 * Get all collections (draft by default)
 */
export async function GET(request: NextRequest) {
  try {
    const roleCheck = await requireStudioProjectRole(request, STUDIO_READ_ROLES);
    if (!roleCheck.ok) return roleCheck.response;

    // Always get draft collections in the builder
    const collections = await getAllCollections({ is_published: false, deleted: false }, roleCheck.context.project.id);
    
    return noCache({
      data: collections,
    });
  } catch (error) {
    console.error('Error fetching collections:', error);
    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to fetch collections' },
      500
    );
  }
}

/**
 * POST /ycode/api/collections
 * Create a new collection
 */
export async function POST(request: NextRequest) {
  try {
    const roleCheck = await requireStudioProjectRole(request, STUDIO_WRITE_ROLES);
    if (!roleCheck.ok) return roleCheck.response;

    const body = await request.json();
    
    // Validate required fields
    if (!body.name) {
      return noCache(
        { error: 'Missing required field: name' },
        400
      );
    }
    
    const collection = await createCollection({
      name: body.name,
      sorting: body.sorting || null,
      order: body.order ?? 0,
      is_published: false, // Always create as draft
    }, roleCheck.context.project.id);
    
    return noCache(
      { data: collection },
      201
    );
  } catch (error) {
    console.error('Error creating collection:', error);
    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to create collection' },
      500
    );
  }
}
