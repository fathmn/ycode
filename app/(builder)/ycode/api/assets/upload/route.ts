import { NextRequest, NextResponse } from 'next/server';
import { uploadFile as uploadFileToStorage } from '@/lib/file-upload';
import { isAssetOfType, ASSET_CATEGORIES } from '@/lib/asset-utils';
import { noCache } from '@/lib/api-response';
import { requireStudioProjectRole, type StudioProjectRole } from '@/lib/studio-platform';

const STUDIO_WRITE_ROLES: StudioProjectRole[] = [
  'studio_admin',
  'studio_developer',
  'customer_owner',
  'customer_editor',
];

/**
 * POST /ycode/api/assets/upload
 * 
 * Upload a new asset file to Supabase Storage and create database record
 */
export async function POST(request: NextRequest) {
  try {
    const roleCheck = await requireStudioProjectRole(request, STUDIO_WRITE_ROLES);
    if (!roleCheck.ok) return roleCheck.response;
    const projectId = roleCheck.context.project.id;

    const formData = await request.formData();
    const file = formData.get('file') as File;
    const source = formData.get('source') as string | null;

    if (!file) {
      return noCache(
        { error: 'No file provided' },
        400
      );
    }

    if (!source) {
      return noCache(
        { error: 'Source is required' },
        400
      );
    }

    // Validate file type
    if (!isAssetOfType(file.type, ASSET_CATEGORIES.IMAGES)) {
      return noCache(
        { error: 'Only image files are allowed' },
        400
      );
    }

    // Validate file size (10MB max)
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      return noCache(
        { error: 'File size must be less than 10MB' },
        400
      );
    }

    // Upload file to Supabase Storage and create asset record
    // This automatically extracts dimensions for images using sharp
    const asset = await uploadFileToStorage(file, source, undefined, undefined, projectId);

    if (!asset) {
      return noCache(
        { error: 'Failed to upload asset' },
        500
      );
    }

    return noCache({
      data: asset,
    });
  } catch (error) {
    console.error('Failed to upload asset:', error);
    
    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to upload asset' },
      500
    );
  }
}
