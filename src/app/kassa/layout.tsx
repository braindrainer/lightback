import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import { hat, requireRole } from '@/lib/auth';
import { requireModul } from '@/lib/module';
import { PwaRegistrieren } from '@/components/vorort/pwa';
import KassaNav from './KassaNav';

export const metadata: Metadata = {
  title: { default: 'Kassa', template: '%s · Kassa' },
  manifest: '/manifest-kassa.webmanifest',
  appleWebApp: { capable: true, title: 'LoC Kassa', statusBarStyle: 'black' },
  icons: { icon: '/icons/vorort.svg', apple: '/icons/vorort-192.png' },
};
export const viewport: Viewport = { themeColor: '#070b14', width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default async function KassaLayout({ children }: { children: React.ReactNode }) {
  const u = await requireRole('kassa');
  await requireModul('kassa');
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 flex min-h-12 shrink-0 items-center gap-1 bg-nacht px-2 text-white print:hidden">
        <Link href="/" className="inline-flex min-h-12 items-center rounded-lg px-2 text-sm text-gold underline-offset-4 hover:underline">
          <span aria-hidden="true">←&nbsp;</span><span className="max-sm:sr-only">Übersicht</span>
        </Link>
        <KassaNav admin={hat(u, 'admin')} />
        <span className="ml-auto hidden truncate pl-2 text-sm text-white/80 md:inline">{u.name}</span>
      </header>
      <main id="inhalt" className="flex flex-1 flex-col">{children}</main>
      <PwaRegistrieren pfad="/sw-kassa.js" scope="/kassa" />
    </div>
  );
}
