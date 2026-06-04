import { NextRequest, NextResponse } from 'next/server';
import { getAllLocales, createLocale } from '@/lib/repositories/localeRepository';
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
 * GET /ycode/api/locales
 * Get all locales
 */
export async function GET(request: NextRequest) {
  try {
    const roleCheck = await requireStudioProjectRole(request, LOCALE_READ_ROLES);
    if (!roleCheck.ok) return roleCheck.response;

    const locales = await getAllLocales(false, roleCheck.context.project.id);
    
    return NextResponse.json({ data: locales });
  } catch (error) {
    console.error('Error fetching locales:', error);
    return NextResponse.json(
      { error: 'Failed to fetch locales' },
      { status: 500 }
    );
  }
}

/**
 * POST /ycode/api/locales
 * Create a new locale
 */
export async function POST(request: NextRequest) {
  try {
    const roleCheck = await requireStudioProjectRole(request, LOCALE_WRITE_ROLES);
    if (!roleCheck.ok) return roleCheck.response;

    const body = await request.json();
    const { code, label, is_default } = body;
    
    if (!code || !label) {
      return NextResponse.json(
        { error: 'Missing required fields: code, label' },
        { status: 400 }
      );
    }
    
    const { locale, locales } = await createLocale({ code, label, is_default }, roleCheck.context.project.id);
    
    return NextResponse.json({ data: { locale, locales } }, { status: 201 });
  } catch (error) {
    console.error('Error creating locale:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create locale' },
      { status: 500 }
    );
  }
}
