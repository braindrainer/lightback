'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { NavItem } from '@/lib/nav';

function Icon({ d }: { d: string }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;
}

const initialen = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((t) => t[0]!.toUpperCase()).join('') || '?';

type Badge = { n: number; text: string };

export default function Nav({ gruppen, name, rollen, badges = {}, suche = false }: { gruppen: { titel: string; items: NavItem[] }[]; name: string; rollen: string; badges?: Record<string, Badge>; suche?: boolean }) {
  const pfad = usePathname();
  const [offen, setOffen] = useState(false);
  const [sichtbar, setSichtbar] = useState(false); // für die Schiebe-Animation
  // eingeklappte Gruppen (gemerkt im Browser; erst nach dem Laden angewendet, damit Server und Browser gleich rendern)
  const [zu, setZu] = useState<string[]>([]);
  useEffect(() => { try { setZu(JSON.parse(localStorage.getItem('lb-nav-zu') ?? '[]')); } catch { /* privat */ } }, []);
  const umschalten = (t: string) => setZu((alt) => {
    const neu = alt.includes(t) ? alt.filter((x) => x !== t) : [...alt, t];
    try { localStorage.setItem('lb-nav-zu', JSON.stringify(neu)); } catch { /* privat */ }
    return neu;
  });
  const knopf = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  // längster passender Pfad ist aktiv (sonst wäre bei /bestellungen/neu auch /bestellungen markiert)
  const alle = gruppen.flatMap((g) => g.items.map((i) => i.href));
  const treffer = alle.filter((h) => (h === '/' ? pfad === '/' : pfad === h || pfad.startsWith(h + '/'))).sort((a, b) => b.length - a.length)[0];
  const aktiv = (h: string) => h === treffer;

  // Mobilmenü: von rechts über die ganze Fläche, Esc schließt, Fokus bleibt im Menü, Seite scrollt nicht
  useEffect(() => {
    if (!offen) return;
    requestAnimationFrame(() => setSichtbar(true));
    document.body.style.overflow = 'hidden';
    panel.current?.querySelector<HTMLElement>('a,button')?.focus();
    const taste = (e: KeyboardEvent) => {
      if (e.key === 'Escape') schliessen();
      if (e.key === 'Tab' && panel.current) {
        const f = [...panel.current.querySelectorAll<HTMLElement>('a,button')];
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f.at(-1)?.focus(); }
        else if (!e.shiftKey && document.activeElement === f.at(-1)) { e.preventDefault(); f[0]?.focus(); }
      }
    };
    document.addEventListener('keydown', taste);
    return () => { document.removeEventListener('keydown', taste); document.body.style.overflow = ''; };
  }, [offen]); // eslint-disable-line react-hooks/exhaustive-deps

  function schliessen() {
    const ruhig = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setSichtbar(false);
    setTimeout(() => { setOffen(false); knopf.current?.focus(); }, ruhig ? 0 : 220);
  }
  useEffect(() => { if (offen) schliessen(); }, [pfad]); // eslint-disable-line react-hooks/exhaustive-deps

  const logo = <img src="/img/logo-wortmarke.svg" alt="Light of Creation" className="h-11 w-auto" />;

  const suchfeld = suche && (
    <form action="/bestellungen" role="search" className="px-1">
      <label htmlFor="nav-suche" className="sr-only">Bestellung, Ticketcode, Name oder E-Mail suchen</label>
      <div className="flex items-center gap-2 rounded-lg border border-white/15 bg-white/[.06] px-2.5 focus-within:border-gold">
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-white/60" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>
        <input id="nav-suche" name="q" type="search" placeholder="Suchen …" className="min-h-10 w-full bg-transparent text-[14px] text-white outline-none placeholder:text-white/50" />
      </div>
    </form>
  );

  const liste = (
    <nav aria-label="Hauptmenü" className="flex flex-col gap-4">
      {gruppen.map((g) => {
        const eingeklappt = !!g.titel && zu.includes(g.titel) && !g.items.some((i) => aktiv(i.href));
        const summe = g.items.reduce((n, i) => n + (badges[i.href]?.n ?? 0), 0);
        return (
          <div key={g.titel || 'start'}>
            {g.titel && (
              <button type="button" onClick={() => umschalten(g.titel)} aria-expanded={!eingeklappt}
                className="mb-1 flex w-full items-center justify-between rounded-md px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/55 hover:text-white">
                <span>{g.titel}{eingeklappt && summe > 0 && <span className="ml-2 rounded-full bg-gold px-1.5 text-[10px] text-nacht">{summe}</span>}</span>
                <svg aria-hidden="true" viewBox="0 0 24 24" className={`h-3.5 w-3.5 transition-transform ${eingeklappt ? '-rotate-90' : ''}`} fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M6 9l6 6 6-6" /></svg>
              </button>
            )}
            {!eingeklappt && (
              <ul className="grid gap-0.5">
                {g.items.map((i) => {
                  const b = badges[i.href];
                  return (
                    <li key={i.href}>
                      <Link href={i.href} aria-current={aktiv(i.href) ? 'page' : undefined}
                        className={`relative flex items-center gap-3 rounded-lg px-3 py-2 text-[14px] transition-colors ${aktiv(i.href) ? 'bg-white/10 font-semibold text-gold before:absolute before:inset-y-1.5 before:-left-3 before:w-[3px] before:rounded-r before:bg-gold' : 'text-white/80 hover:bg-white/[.06] hover:text-white'}`}>
                        <Icon d={i.icon} /><span className="flex-1">{i.label}</span>
                        {b && b.n > 0 && <span className="rounded-full bg-gold px-2 py-0.5 text-[11px] font-bold leading-none text-nacht"><span aria-hidden="true">{b.n}</span><span className="sr-only">, {b.n} {b.text}</span></span>}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </nav>
  );

  const fuss = (
    <div className="mt-auto border-t border-white/10 pt-4">
      <div className="flex items-center gap-3 px-3">
        <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gold text-[13px] font-bold text-nacht">{initialen(name)}</span>
        <div className="min-w-0">
          <p className="truncate text-[14px] font-semibold text-white">{name}</p>
          <p className="truncate text-[12px] text-white/60">{rollen}</p>
        </div>
      </div>
      <div className="mt-3 flex gap-2 px-3 text-[13px]">
        <Link href="/konto" className="rounded-md px-2 py-1 text-white/80 hover:bg-white/[.06] hover:text-white">Mein Konto</Link>
        <form action="/api/auth/logout" method="post"><button className="rounded-md px-2 py-1 text-gold hover:bg-white/[.06]">Abmelden</button></form>
      </div>
    </div>
  );

  return (
    <>
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col gap-6 overflow-y-auto border-r border-white/5 bg-nacht px-3 py-6 lg:flex">
        <Link href="/" className="px-3" aria-label="Light of Creation – zur Übersicht">{logo}</Link>
        {suchfeld}
        {liste}
        {fuss}
      </aside>

      <div className="sticky top-0 z-30 flex items-center justify-between bg-nacht px-4 py-2.5 lg:hidden">
        <Link href="/" aria-label="Light of Creation – zur Übersicht"><img src="/img/logo-wortmarke.svg" alt="" className="h-9 w-auto" /></Link>
        <button ref={knopf} type="button" onClick={() => setOffen(true)} aria-expanded={offen} aria-controls="mobilmenue" className="flex items-center gap-2 rounded-lg border border-white/25 px-3 py-2 text-sm text-white">
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>Menü
        </button>
      </div>

      {offen && (
        <div id="mobilmenue" ref={panel} role="dialog" aria-modal="true" aria-label="Menü"
          className={`fixed inset-0 z-40 flex flex-col gap-6 overflow-y-auto bg-nacht px-3 pb-6 pt-3 transition-transform duration-200 ease-out motion-reduce:transition-none lg:hidden ${sichtbar ? 'translate-x-0' : 'translate-x-full'}`}>
          <div className="flex items-center justify-between px-1">
            <img src="/img/logo-wortmarke.svg" alt="" className="h-9 w-auto" />
            <button type="button" onClick={schliessen} className="flex items-center gap-2 rounded-lg border border-white/25 px-3 py-2 text-sm text-white">
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>Schließen
            </button>
          </div>
          {suchfeld}
          {liste}
          {fuss}
        </div>
      )}
    </>
  );
}
