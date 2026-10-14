'use client';
// Punkte unter den wischbaren Tickets: zeigen, welches Ticket sichtbar ist, und springen per Tipp dorthin.
import { useEffect, useState } from 'react';

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
    const k = document.getElementById(ziel)?.children[i] as HTMLElement | undefined;
    k?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  };
  return (
    <div className="tm-punkte">
      <p className="tm-zaehler" aria-live="polite">{labels[aktiv]}</p>
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
