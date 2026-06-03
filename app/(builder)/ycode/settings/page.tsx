import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { studioProjectRoutePathFromSlug } from '@/lib/studio-project-path';

export default async function SettingsPage() {
  const requestHeaders = await headers();
  const projectPathSlug = requestHeaders.get('x-studio-project-slug');
  redirect(studioProjectRoutePathFromSlug(projectPathSlug, '/ycode/settings/general'));
}
