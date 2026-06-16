import type { Metadata } from 'next';
import {
  generatePublishedHomeMetadata,
  renderPublishedHome,
} from '@/app/(site)/published-route';

export const revalidate = 60;

interface PageProps {
  params: Promise<{ projectId: string }>;
}

export default async function PublishedHome({ params }: PageProps) {
  const { projectId } = await params;
  return renderPublishedHome(projectId);
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { projectId } = await params;
  return generatePublishedHomeMetadata(projectId);
}
