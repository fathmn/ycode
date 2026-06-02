import { NextRequest } from 'next/server';
import { recordExplicitStudioPreviewApproval } from '@/lib/studio-platform';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(request: NextRequest) {
  return recordExplicitStudioPreviewApproval(request);
}
