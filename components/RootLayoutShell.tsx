import React from 'react';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import DarkModeProvider from '@/components/DarkModeProvider';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

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
      <body className={`${inter.variable} font-sans antialiased text-xs`} suppressHydrationWarning>
        <DarkModeProvider>
          {children}
        </DarkModeProvider>
      </body>
    </html>
  );
}
