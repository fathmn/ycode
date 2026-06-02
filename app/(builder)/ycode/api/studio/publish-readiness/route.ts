import { getStudioPublishReadinessForRequest } from '@/lib/studio-platform';
import type { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  return getStudioPublishReadinessForRequest(request);
}
