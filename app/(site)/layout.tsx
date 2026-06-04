import '@/app/globals.css';
import RootLayoutShell, { defaultMetadata } from '@/components/RootLayoutShell';

export const metadata = defaultMetadata;

export default async function SiteLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <RootLayoutShell>
      {children}
    </RootLayoutShell>
  );
}
