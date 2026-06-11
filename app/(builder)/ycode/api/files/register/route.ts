import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { createAsset } from '@/lib/repositories/assetRepository';
import { STORAGE_BUCKET, getDisplayName } from '@/lib/asset-constants';
import { requireStudioProjectRole, type StudioProjectRole } from '@/lib/studio-platform';

const STUDIO_WRITE_ROLES: StudioProjectRole[] = [
  'studio_admin',
  'studio_developer',
  'customer_owner',
  'customer_editor',
];

export const runtime = 'nodejs';

/**
 * POST /ycode/api/files/register
 * Create an Asset database record after a direct browser-to-storage upload completes.
 * Pairs with the presign route for large file uploads.
 */
export async function POST(request: NextRequest) {
  try {
    const roleCheck = await requireStudioProjectRole(request, STUDIO_WRITE_ROLES);
    if (!roleCheck.ok) return roleCheck.response;
    const projectId = roleCheck.context.project.id;

    const body = await request.json();
    const { storagePath, filename, mimeType, fileSize, source, customName, assetFolderId } = body as {
      storagePath: string;
      filename: string;
      mimeType: string;
      fileSize: number;
      source: string;
      customName?: string;
      assetFolderId?: string | null;
    };

    if (!storagePath || !filename || !mimeType || !fileSize || !source) {
      return NextResponse.json(
        { error: 'storagePath, filename, mimeType, fileSize, and source are required' },
        { status: 400 }
      );
    }

    const supabase = await getSupabaseAdmin();

    if (!supabase) {
      return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
    }

    const { data: urlData } = supabase.storage
      .from(STORAGE_BUCKET)
      .getPublicUrl(storagePath);

    const asset = await createAsset({
      filename: getDisplayName(filename, customName),
      storage_path: storagePath,
      public_url: urlData.publicUrl,
      file_size: fileSize,
      mime_type: mimeType,
      source,
      asset_folder_id: assetFolderId,
    }, projectId);

    return NextResponse.json({ data: asset }, { status: 200 });
  } catch (error) {
    console.error('Error registering asset:', error);
    return NextResponse.json({ error: 'Failed to register asset' }, { status: 500 });
  }
}
