import type { Metadata } from 'next';
import {
  generatePublishedSlugMetadata,
  renderPublishedSlug,
} from '@/app/(site)/published-route';

export const revalidate = 60;
export const dynamicParams = true;

interface PageProps {
  params: Promise<{ projectId: string; slug: string | string[] }>;
}

function slugFromParams(slug: string | string[]) {
  return Array.isArray(slug) ? slug.join('/') : slug;
}

export default async function PublishedSlug({ params }: PageProps) {
  const { projectId, slug } = await params;
  return renderPublishedSlug(slugFromParams(slug), projectId);
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { projectId, slug } = await params;
  return generatePublishedSlugMetadata(slugFromParams(slug), projectId);
}
