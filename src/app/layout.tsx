import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = { title: { default: 'Light of Creation – Backend', template: '%s · Light of Creation' }, robots: { index: false, follow: false }, manifest: '/manifest.webmanifest' };
export const viewport: Viewport = { themeColor: '#070b14', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body className="antialiased">
        <a href="#inhalt" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-gold focus:px-4 focus:py-2 focus:text-nacht">Zum Inhalt</a>
        {children}
      </body>
    </html>
  );
}
