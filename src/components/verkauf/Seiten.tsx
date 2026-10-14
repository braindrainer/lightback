import Link from 'next/link';
import { Icon } from '@/components/icons';

/** Blättern; behält die übrigen Suchparameter. Mit gesamt/pro: „1–50 von 262“ und Seitengröße wählbar. */
export function Seiten({ seite, seiten, basis, params, gesamt, pro, groessen }: { seite: number; seiten: number; basis: string; params: Record<string, string | undefined>; gesamt?: number; pro?: number; groessen?: number[] }) {
  if (seiten <= 1 && !groessen) return null;
  const href = (p: Record<string, string | undefined>) => {
    const q = new URLSearchParams(Object.entries({ ...params, ...p }).filter(([, v]) => v) as [string, string][]);
    return `${basis}?${q}`;
  };
  const nummern = [...new Set([1, seite - 1, seite, seite + 1, seiten].filter((n) => n >= 1 && n <= seiten))].sort((a, b) => a - b);
  const knopf = 'inline-grid h-9 min-w-9 place-items-center rounded-lg px-2 text-sm';
  return (
    <nav aria-label="Seiten" className="flex flex-wrap items-center justify-between gap-3 border-t border-line-soft px-4 py-3 text-sm">
      <span className="text-muted">
        {gesamt != null && pro ? <>{gesamt ? (seite - 1) * pro + 1 : 0}–{Math.min(seite * pro, gesamt)} von <span className="num font-medium text-ink">{gesamt}</span></> : <>Seite {seite} von {seiten}</>}
      </span>
      {seiten > 1 && (
        <ul className="flex items-center gap-1">
          <li>{seite > 1 ? <Link className={`${knopf} hover:bg-paper-deep`} href={href({ seite: String(seite - 1) })} aria-label="Vorherige Seite"><Icon name="zurueck" className="h-4 w-4" /></Link> : <span className={`${knopf} text-muted/50`} aria-hidden="true"><Icon name="zurueck" className="h-4 w-4" /></span>}</li>
          {nummern.map((n, i) => (
            <li key={n} className="flex items-center gap-1">
              {i > 0 && n - nummern[i - 1] > 1 && <span aria-hidden="true" className="px-1 text-muted">…</span>}
              <Link href={href({ seite: String(n) })} aria-current={n === seite ? 'page' : undefined} aria-label={`Seite ${n}`}
                className={`${knopf} num ${n === seite ? 'bg-nacht font-semibold text-white' : 'hover:bg-paper-deep'}`}>{n}</Link>
            </li>
          ))}
          <li>{seite < seiten ? <Link className={`${knopf} hover:bg-paper-deep`} href={href({ seite: String(seite + 1) })} aria-label="Nächste Seite"><Icon name="pfeil" className="h-4 w-4" /></Link> : <span className={`${knopf} text-muted/50`} aria-hidden="true"><Icon name="pfeil" className="h-4 w-4" /></span>}</li>
        </ul>
      )}
      {groessen && pro && (
        <div className="flex items-center gap-1.5 text-muted">
          <span id="pro-seite">Pro Seite</span>
          <ul aria-labelledby="pro-seite" className="flex gap-1">
            {groessen.map((g) => <li key={g}><Link href={href({ pro: String(g), seite: undefined })} aria-current={g === pro ? 'true' : undefined} className={`${knopf} num ${g === pro ? 'bg-paper-deep font-semibold text-ink' : 'hover:bg-paper-deep'}`}>{g}</Link></li>)}
          </ul>
        </div>
      )}
    </nav>
  );
}

/** Kleiner Balken mit Textalternative */
export function Balken({ wert, max, label }: { wert: number; max: number; label: string }) {
  const pct = max ? Math.min(100, Math.round((wert / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-2 whitespace-nowrap">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-line" role="img" aria-label={`${label}: ${pct} %`}><div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} /></div>
      <span className="num text-xs text-muted" aria-hidden="true">{pct} %</span>
    </div>
  );
}
