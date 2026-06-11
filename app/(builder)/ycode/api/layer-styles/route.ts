import { NextRequest, NextResponse } from 'next/server';
import { getAllStyles, createStyle } from '@/lib/repositories/layerStyleRepository';
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

/**
 * GET /ycode/api/layer-styles
 * List all layer styles (draft versions)
 */
export async function GET(request: NextRequest) {
  try {
    const roleCheck = await requireStudioProjectRole(request, STUDIO_READ_ROLES);
    if (!roleCheck.ok) return roleCheck.response;

    const styles = await getAllStyles(false, roleCheck.context.project.id);
    return NextResponse.json({ data: styles });
  } catch (error) {
    console.error('Error fetching layer styles:', error);
    return NextResponse.json(
      { error: 'Failed to fetch layer styles' },
      { status: 500 }
    );
  }
}

/**
 * POST /ycode/api/layer-styles
 * Create a new layer style
 */
export async function POST(request: NextRequest) {
  try {
    const roleCheck = await requireStudioProjectRole(request, STUDIO_WRITE_ROLES);
    if (!roleCheck.ok) return roleCheck.response;

    const body = await request.json();
    
    if (!body.name || body.classes === undefined) {
      return NextResponse.json(
        { error: 'Missing required fields: name and classes' },
        { status: 400 }
      );
    }
    
    const style = await createStyle({
      name: body.name,
      classes: body.classes,
      design: body.design,
      group: body.group,
    }, roleCheck.context.project.id);
    
    return NextResponse.json({ data: style }, { status: 201 });
  } catch (error) {
    console.error('Error creating layer style:', error);
    return NextResponse.json(
      { error: 'Failed to create layer style' },
      { status: 500 }
    );
  }
}
