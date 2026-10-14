import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { istAppHost } from '@/lib/apphost';
import { requireRole } from '@/lib/auth';
import { InstallHinweis } from '@/components/vorort/InstallHinweis';
import { PwaRegistrieren } from '@/components/vorort/pwa';

// Auf der App-Domain (lightapp.*) das Manifest mit Scope „/“, sonst das des Scanners unter /einlass
export async function generateMetadata(): Promise<Metadata> {
  const app = istAppHost(await headers());
  return {
    title: 'Einlass',
    manifest: app ? '/manifest-lightapp.webmanifest' : '/manifest-einlass.webmanifest',
    appleWebApp: { capable: true, title: 'LoC Einlass', statusBarStyle: 'black-translucent' },
    icons: { icon: '/icons/vorort.svg', apple: '/icons/vorort-192.png' },
  };
}
export const viewport: Viewport = { themeColor: '#070b14', width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default async function EinlassLayout({ children }: { children: React.ReactNode }) {
  await requireRole('einlass');
  const app = istAppHost(await headers());
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-nacht text-white">
      {app && <InstallHinweis />}
      <main id="inhalt" className="flex min-h-0 flex-1 flex-col">{children}</main>
      <PwaRegistrieren pfad="/sw-einlass.js" scope="/einlass" />
    </div>
  );
}
