import { NextRequest, NextResponse } from 'next/server';
import { getLocaleById, updateLocale, deleteLocale } from '@/lib/repositories/localeRepository';
import { requireStudioProjectRole, type StudioProjectRole } from '@/lib/studio-platform';

const LOCALE_READ_ROLES: StudioProjectRole[] = [
  'studio_admin',
  'studio_developer',
  'customer_owner',
  'customer_editor',
  'customer_viewer',
];

const LOCALE_WRITE_ROLES: StudioProjectRole[] = [
  'studio_admin',
  'studio_developer',
  'customer_owner',
  'customer_editor',
];

/**
 * GET /ycode/api/locales/[id]
 * Get a single locale by ID
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const roleCheck = await requireStudioProjectRole(request, LOCALE_READ_ROLES);
    if (!roleCheck.ok) return roleCheck.response;

    const { id } = await params;
    const locale = await getLocaleById(id, false, roleCheck.context.project.id);
    
    if (!locale) {
      return NextResponse.json({ error: 'Locale not found' }, { status: 404 });
    }
    
    return NextResponse.json({ data: locale });
  } catch (error) {
    console.error('Error fetching locale:', error);
    return NextResponse.json(
      { error: 'Failed to fetch locale' },
      { status: 500 }
    );
  }
}

/**
 * PUT /ycode/api/locales/[id]
 * Update a locale
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const roleCheck = await requireStudioProjectRole(request, LOCALE_WRITE_ROLES);
    if (!roleCheck.ok) return roleCheck.response;

    const { id } = await params;
    const body = await request.json();
    const { code, label, is_default } = body;
    
    const updates: any = {};
    if (code !== undefined) updates.code = code;
    if (label !== undefined) updates.label = label;
    if (is_default !== undefined) updates.is_default = is_default;
    
    const { locale, locales } = await updateLocale(id, updates, roleCheck.context.project.id);
    
    return NextResponse.json({ data: { locale, locales } });
  } catch (error) {
    console.error('Error updating locale:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update locale' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /ycode/api/locales/[id]
 * Delete a locale (soft delete)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const roleCheck = await requireStudioProjectRole(request, LOCALE_WRITE_ROLES);
    if (!roleCheck.ok) return roleCheck.response;

    const { id } = await params;
    await deleteLocale(id, roleCheck.context.project.id);
    
    return NextResponse.json({ message: 'Locale deleted successfully' });
  } catch (error) {
    console.error('Error deleting locale:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete locale' },
      { status: 500 }
    );
  }
}
