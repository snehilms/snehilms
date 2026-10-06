import type { Metadata, Viewport } from 'next';
import { Sora, JetBrains_Mono } from 'next/font/google';
import { meta, identity } from '@/config/content';
import { MOTION_BOOT } from '@/lib/motionPref';
import './globals.css';

/* Sora: round, open bowls (soft) on a strict geometric skeleton with crisp
   terminals (technical). JetBrains Mono carries data and readouts only.
   Both are self-hosted at build time by next/font, with metric-matched
   fallbacks so the swap doesn't reflow the page. */
const sans = Sora({ subsets: ['latin'], variable: '--font-sora', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains', display: 'swap' });

export const metadata: Metadata = {
  metadataBase: new URL(meta.url),
  title: meta.title,
  description: meta.description,
  openGraph: {
    title: meta.title,
    description: meta.description,
    url: meta.url,
    siteName: identity.name,
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: meta.title,
    description: meta.description,
  },
};

export const viewport: Viewport = {
  themeColor: '#dde1e7', // --c-ground
  colorScheme: 'light',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: the boot script sets data-motion before React hydrates.
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        {/* Must run before any app code: see lib/motionPref.ts. */}
        <script dangerouslySetInnerHTML={{ __html: MOTION_BOOT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
