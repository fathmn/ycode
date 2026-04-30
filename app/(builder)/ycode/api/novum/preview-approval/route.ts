import { NextRequest } from 'next/server';
import { recordExplicitNovumPreviewApproval } from '@/lib/novum-platform';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(request: NextRequest) {
  return recordExplicitNovumPreviewApproval(request);
}
