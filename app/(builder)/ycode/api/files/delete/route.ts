import { NextRequest, NextResponse } from 'next/server';
import { getAssetById, deleteAsset } from '@/lib/repositories/assetRepository';
import { requireStudioProjectRole, type StudioProjectRole } from '@/lib/studio-platform';
import { recordInStudioProject } from '@/lib/project-scope';

const STUDIO_WRITE_ROLES: StudioProjectRole[] = [
  'studio_admin',
  'studio_developer',
  'customer_owner',
  'customer_editor',
];

/**
 * DELETE /ycode/api/files/delete
 * Soft-delete an asset (marks as deleted_at in database)
 * Physical file is only deleted when publishing if the asset was never published
 */
export async function DELETE(request: NextRequest) {
  try {
    const roleCheck = await requireStudioProjectRole(request, STUDIO_WRITE_ROLES);
    if (!roleCheck.ok) return roleCheck.response;
    const projectId = roleCheck.context.project.id;

    const { searchParams } = new URL(request.url);
    const assetId = searchParams.get('assetId');

    if (!assetId) {
      return NextResponse.json(
        { error: 'Asset ID is required' },
        { status: 400 }
      );
    }

    const asset = await getAssetById(assetId);
    if (!asset || !recordInStudioProject(asset, projectId)) {
      return NextResponse.json(
        { error: 'Asset not found' },
        { status: 404 }
      );
    }

    await deleteAsset(assetId);

    return NextResponse.json(
      { message: 'Asset deleted successfully' },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error deleting asset:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete asset' },
      { status: 500 }
    );
  }
}
