import { NextRequest, NextResponse } from 'next/server';
import { getAllComponents, createComponent } from '@/lib/repositories/componentRepository';
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
 * GET /ycode/api/components
 * Get all components
 */
export async function GET(request: NextRequest) {
  try {
    const roleCheck = await requireStudioProjectRole(request, STUDIO_READ_ROLES);
    if (!roleCheck.ok) return roleCheck.response;

    const components = await getAllComponents(false, roleCheck.context.project.id);
    
    return NextResponse.json({ data: components });
  } catch (error) {
    console.error('Error fetching components:', error);
    return NextResponse.json(
      { error: 'Failed to fetch components' },
      { status: 500 }
    );
  }
}

/**
 * POST /ycode/api/components
 * Create a new component
 */
export async function POST(request: NextRequest) {
  try {
    const roleCheck = await requireStudioProjectRole(request, STUDIO_WRITE_ROLES);
    if (!roleCheck.ok) return roleCheck.response;

    const body = await request.json();
    const { name, layers, variables } = body;
    
    if (!name || !layers) {
      return NextResponse.json(
        { error: 'Missing required fields: name, layers' },
        { status: 400 }
      );
    }
    
    const component = await createComponent({ name, layers, variables }, roleCheck.context.project.id);
    
    return NextResponse.json({ data: component }, { status: 201 });
  } catch (error) {
    console.error('Error creating component:', error);
    return NextResponse.json(
      { error: 'Failed to create component' },
      { status: 500 }
    );
  }
}
