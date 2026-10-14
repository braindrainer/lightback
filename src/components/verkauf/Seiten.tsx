import Link from 'next/link';

/** Blättern; behält die übrigen Suchparameter */
export function Seiten({ seite, seiten, basis, params }: { seite: number; seiten: number; basis: string; params: Record<string, string | undefined> }) {
  if (seiten <= 1) return null;
  const href = (n: number) => {
    const q = new URLSearchParams(Object.entries({ ...params, seite: String(n) }).filter(([, v]) => v) as [string, string][]);
    return `${basis}?${q}`;
  };
  return (
    <nav aria-label="Seiten" className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
      {seite > 1 ? <Link className="btn-secondary btn-sm" href={href(seite - 1)}>← Zurück</Link> : <span />}
      <span className="text-muted">Seite {seite} von {seiten}</span>
      {seite < seiten ? <Link className="btn-secondary btn-sm" href={href(seite + 1)}>Weiter →</Link> : <span />}
    </nav>
  );
}

/** Kleiner Balken mit Textalternative */
export function Balken({ wert, max, label }: { wert: number; max: number; label: string }) {
  const pct = max ? Math.min(100, Math.round((wert / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-2 whitespace-nowrap">
      <div className="h-2 w-24 rounded-full bg-line" role="img" aria-label={`${label}: ${pct} %`}><div className="h-2 rounded-full bg-accent" style={{ width: `${pct}%` }} /></div>
      <span className="num text-xs text-muted" aria-hidden="true">{pct} %</span>
    </div>
  );
}
