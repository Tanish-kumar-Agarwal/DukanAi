import type { Metadata, Viewport } from 'next';
import { RootLayout } from '@/components/layout/RootLayout';
import { ToastProvider } from '@/components/ui/Toast';
import Providers from '@/components/Providers';
import './globals.css';

/**
 * Every route renders per request: the middleware issues a fresh CSP script
 * nonce on each response (roadmap 6.4) and a prerendered page would carry
 * inline scripts without it. The app is session-gated, so nothing was
 * cacheable across users anyway.
 */
export const dynamic = 'force-dynamic';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export const metadata: Metadata = {
  title: 'DukaanAI - AI-Powered Retail OS',
  description: 'AI-powered retail operating system for small businesses',
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Providers>
          <ToastProvider>
            <RootLayout>{children}</RootLayout>
          </ToastProvider>
        </Providers>
      </body>
    </html>
  );
}
