import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { PwaRegistrieren } from '@/components/vorort/pwa';

export const metadata: Metadata = {
  title: 'Einlass',
  manifest: '/manifest-einlass.webmanifest',
  appleWebApp: { capable: true, title: 'LoC Einlass', statusBarStyle: 'black' },
  icons: { icon: '/icons/vorort.svg', apple: '/icons/vorort-192.png' },
};
export const viewport: Viewport = { themeColor: '#070b14', width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default async function EinlassLayout({ children }: { children: React.ReactNode }) {
  const u = await requireRole('einlass');
  return (
    <div className="flex min-h-dvh flex-col bg-nacht text-white">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-white/15 px-2">
        <Link href="/" className="inline-flex min-h-12 items-center rounded-lg px-2 text-sm text-gold underline-offset-4 hover:underline">
          <span aria-hidden="true">←&nbsp;</span>Übersicht
        </Link>
        <span className="font-semibold">Einlass</span>
        <span className="ml-auto truncate text-sm text-white/80">{u.name}</span>
      </header>
      <main id="inhalt" className="flex flex-1 flex-col">{children}</main>
      <PwaRegistrieren pfad="/sw-einlass.js" scope="/einlass" />
    </div>
  );
}
