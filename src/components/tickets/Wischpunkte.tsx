'use client';
// Steuerung über den wischbaren Tickets: „Ticket 1 von 3“, Pfeile zum Blättern, Punkte zum Springen.
import { useEffect, useState } from 'react';

const Pfeil = ({ links }: { links?: boolean }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={links ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'} />
  </svg>
);

export default function Wischpunkte({ ziel, labels }: { ziel: string; labels: string[] }) {
  const [aktiv, setAktiv] = useState(0);
  useEffect(() => {
    const box = document.getElementById(ziel);
    if (!box) return;
    const karten = [...box.children] as HTMLElement[];
    const io = new IntersectionObserver((e) => {
      for (const x of e) if (x.isIntersecting) setAktiv(karten.indexOf(x.target as HTMLElement));
    }, { root: box, threshold: 0.6 });
    karten.forEach((k) => io.observe(k));
    return () => io.disconnect();
  }, [ziel]);
  if (labels.length < 2) return null;
  const springe = (i: number) => {
    const k = document.getElementById(ziel)?.children[Math.max(0, Math.min(labels.length - 1, i))] as HTMLElement | undefined;
    k?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  };
  return (
    <div className="tm-punkte">
      <div className="tm-blaettern">
        <button type="button" className="tm-pfeil" onClick={() => springe(aktiv - 1)} disabled={aktiv === 0} aria-label="Vorheriges Ticket"><Pfeil links /></button>
        <p className="tm-zaehler" aria-live="polite"><strong>Ticket {aktiv + 1} von {labels.length}</strong><span>{aktiv < labels.length - 1 ? 'Nach links wischen für das nächste Ticket' : 'Nach rechts wischen für die vorigen Tickets'}</span></p>
        <button type="button" className="tm-pfeil" onClick={() => springe(aktiv + 1)} disabled={aktiv === labels.length - 1} aria-label="Nächstes Ticket"><Pfeil /></button>
      </div>
      <ul>
        {labels.map((l, i) => (
          <li key={l}>
            <button type="button" onClick={() => springe(i)} aria-current={i === aktiv ? 'true' : undefined} aria-label={`Zu ${l}`}>
              <span aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
