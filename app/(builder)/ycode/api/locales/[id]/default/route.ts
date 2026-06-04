import { NextRequest, NextResponse } from 'next/server';
import { setDefaultLocale } from '@/lib/repositories/localeRepository';
import { requireStudioProjectRole, type StudioProjectRole } from '@/lib/studio-platform';

const LOCALE_WRITE_ROLES: StudioProjectRole[] = [
  'studio_admin',
  'studio_developer',
  'customer_owner',
  'customer_editor',
];

/**
 * POST /ycode/api/locales/[id]/default
 * Set a locale as the default
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const roleCheck = await requireStudioProjectRole(request, LOCALE_WRITE_ROLES);
    if (!roleCheck.ok) return roleCheck.response;

    const { id } = await params;
    const locale = await setDefaultLocale(id, roleCheck.context.project.id);
    
    return NextResponse.json({ data: locale });
  } catch (error) {
    console.error('Error setting default locale:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to set default locale' },
      { status: 500 }
    );
  }
}
