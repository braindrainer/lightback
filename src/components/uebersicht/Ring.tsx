import { formatEur } from '@/lib/money';

export type RingTeil = { name: string; wert: number; farbe: string };

/** Ringdiagramm mit Legende (Werte in Cent); die Legende trägt alle Zahlen, die Grafik ist Schmuck */
export function Ring({ teile, titel }: { teile: RingTeil[]; titel: string }) {
  const summe = teile.reduce((s, t) => s + t.wert, 0);
  const r = 42, u = 2 * Math.PI * r;
  let pos = 0;
  return (
    <div className="flex flex-wrap items-center gap-5">
      <svg viewBox="0 0 110 110" className="h-32 w-32 shrink-0" aria-hidden="true">
        <circle cx="55" cy="55" r={r} fill="none" stroke="#f1ebdf" strokeWidth="16" />
        {summe > 0 && teile.map((t) => {
          const l = (t.wert / summe) * u;
          const el = <circle key={t.name} cx="55" cy="55" r={r} fill="none" stroke={t.farbe} strokeWidth="16" strokeDasharray={`${l} ${u - l}`} strokeDashoffset={-pos} transform="rotate(-90 55 55)" />;
          pos += l;
          return el;
        })}
      </svg>
      <ul className="grid min-w-0 flex-1 gap-1.5 text-sm" aria-label={titel}>
        {teile.map((t) => (
          <li key={t.name} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2"><span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-sm" style={{ background: t.farbe }} />{t.name}</span>
            <span className="num text-muted">{formatEur(t.wert)}{summe ? ` · ${Math.round((t.wert / summe) * 100)} %` : ''}</span>
          </li>
        ))}
        {!summe && <li className="text-muted">Noch keine Verkäufe im Zeitraum.</li>}
      </ul>
    </div>
  );
}
