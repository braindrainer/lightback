'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import type { NavItem } from '@/lib/nav';

function Icon({ d }: { d: string }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;
}

export default function Nav({ gruppen, name, rollen }: { gruppen: { titel: string; items: NavItem[] }[]; name: string; rollen: string }) {
  const pfad = usePathname();
  const [offen, setOffen] = useState(false);
  const aktiv = (h: string) => (h === '/' ? pfad === '/' : pfad === h || (pfad.startsWith(h + '/') && !gruppen.some((g) => g.items.some((i) => i.href !== h && i.href.startsWith(h) && pfad.startsWith(i.href)))));
  const liste = (
    <nav aria-label="Hauptmenü" className="flex flex-col gap-5">
      {gruppen.map((g) => (
        <div key={g.titel || 'start'}>
          {g.titel && <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-white/55">{g.titel}</p>}
          <ul className="grid gap-0.5">
            {g.items.map((i) => (
              <li key={i.href}>
                <Link href={i.href} onClick={() => setOffen(false)} aria-current={aktiv(i.href) ? 'page' : undefined}
                  className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-[14px] ${aktiv(i.href) ? 'bg-white/12 font-semibold text-gold' : 'text-white/85 hover:bg-white/8 hover:text-white'}`}>
                  <Icon d={i.icon} />{i.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
  const kopf = (
    <div className="mb-6 px-3">
      <p className="font-serif text-[20px] tracking-wide text-gold">Light of Creation</p>
      <p className="text-[12px] text-white/60">Backend</p>
    </div>
  );
  const fuss = (
    <div className="mt-auto border-t border-white/10 px-3 pt-4 text-[13px] text-white/75">
      <p className="font-semibold text-white">{name}</p>
      <p className="text-[12px]">{rollen}</p>
      <Link href="/konto" onClick={() => setOffen(false)} className="mt-2 inline-block text-white/85 underline underline-offset-4 hover:text-white">Mein Konto</Link>
      <form action="/api/auth/logout" method="post" className="mt-2"><button className="text-gold underline underline-offset-4">Abmelden</button></form>
    </div>
  );
  return (
    <>
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col overflow-y-auto bg-nacht px-3 py-5 lg:flex">{kopf}{liste}{fuss}</aside>
      <div className="sticky top-0 z-30 flex items-center justify-between bg-nacht px-4 py-3 lg:hidden">
        <p className="font-serif text-[18px] text-gold">Light of Creation</p>
        <button type="button" onClick={() => setOffen(!offen)} aria-expanded={offen} aria-controls="mobilmenue" className="rounded-lg border border-white/25 px-3 py-1.5 text-sm text-white">Menü</button>
      </div>
      {offen && <div id="mobilmenue" className="fixed inset-0 top-[52px] z-30 flex flex-col overflow-y-auto bg-nacht px-3 py-5 lg:hidden">{liste}{fuss}</div>}
    </>
  );
}
