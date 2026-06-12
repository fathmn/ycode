import '@/app/site.css';
import RootLayoutShell, { defaultMetadata } from '@/components/RootLayoutShell';

// Studio: Cloud mode uses ISR with explicit projectId — global settings cannot be
// resolved here (no project scope in the root layout). Favicons and global head
// code are injected per project from generate-page-metadata/PageRenderer instead.
export const metadata = defaultMetadata;

export default async function SiteLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Published sites render text with the browser-default (`auto`) font
  // smoothing — matching legacy output. Forcing `antialiased` here would render
  // glyphs thinner/lighter than the original site.
  return (
    <RootLayoutShell bodyClassName="font-sans">
      {children}
    </RootLayoutShell>
  );
}
