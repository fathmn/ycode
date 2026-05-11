import React from 'react';
import type { Metadata } from 'next';
import DarkModeProvider from '@/components/DarkModeProvider';

export const defaultMetadata: Metadata = {
  title: 'studio.novum partners',
  description: 'Kundenstudio für Websites von novum partners',
};

interface RootLayoutShellProps {
  children: React.ReactNode;
  headElements?: React.ReactNode[];
}

export default function RootLayoutShell({ children, headElements }: RootLayoutShellProps) {
  return (
    <html lang="de" suppressHydrationWarning>
      <head>
        {headElements}
      </head>
      <body className="font-sans antialiased text-xs" suppressHydrationWarning>
        <DarkModeProvider>
          {children}
        </DarkModeProvider>
      </body>
    </html>
  );
}
