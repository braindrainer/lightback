import { formatEur } from '@/lib/money';

type Punkt = { label: string; kurz: string; wert: number; tickets: number };

/** Säulendiagramm als SVG; die Daten stehen zusätzlich als Tabelle im aufklappbaren Bereich */
export function Balken({ id, titel, punkte }: { id: string; titel: string; punkte: Punkt[] }) {
  const max = Math.max(1, ...punkte.map((p) => p.wert));
  const schritt = Math.pow(10, Math.floor(Math.log10(max))) * (max / Math.pow(10, Math.floor(Math.log10(max))) > 5 ? 2 : 1);
  const oben = Math.ceil(max / schritt) * schritt;
  const W = 760, H = 240, L = 64, R = 8, T = 10, B = 28;
  const breite = (W - L - R) / Math.max(1, punkte.length);
  const y = (v: number) => T + (H - T - B) * (1 - v / oben);
  const linien = Array.from({ length: Math.round(oben / schritt) + 1 }, (_, i) => i * schritt);
  const jedes = Math.ceil(punkte.length / 12);
  const summe = punkte.reduce((n, p) => n + p.wert, 0);
  const spitze = punkte.reduce((a, p) => (p.wert > a.wert ? p : a), punkte[0] ?? { label: '', wert: 0 });
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-labelledby={`${id}-t ${id}-d`}>
        <title id={`${id}-t`}>{titel}</title>
        <desc id={`${id}-d`}>{punkte.length} Werte, Summe {formatEur(summe)}{spitze?.wert ? `, höchster Wert ${formatEur(spitze.wert)} am ${spitze.label}` : ''}. Die Zahlen stehen in der Tabelle darunter.</desc>
        {linien.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="#e3dccd" />
            <text x={L - 6} y={y(v) + 4} textAnchor="end" fontSize="11" fill="#59617a">{v >= 100000 ? `${Math.round(v / 100000)} Tsd. €` : `${Math.round(v / 100)} €`}</text>
          </g>
        ))}
        {punkte.map((p, i) => (
          <g key={p.label}>
            {p.wert > 0 && <rect x={L + i * breite + breite * 0.15} y={y(p.wert)} width={Math.max(1, breite * 0.7)} height={y(0) - y(p.wert)} fill="#8a6a1f" rx={breite > 8 ? 2 : 0}><title>{`${p.label}: ${formatEur(p.wert)}, ${p.tickets} Tickets`}</title></rect>}
            {i % jedes === 0 && <text x={L + i * breite + breite / 2} y={H - 8} textAnchor="middle" fontSize="11" fill="#59617a">{p.kurz}</text>}
          </g>
        ))}
        <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} stroke="#59617a" />
      </svg>
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer py-1 font-medium text-accent-deep underline underline-offset-4">Daten als Tabelle</summary>
        <div className="mt-2 max-h-80 overflow-auto">
          <table className="table">
            <caption className="sr-only">{titel}</caption>
            <thead><tr><th scope="col">Zeitraum</th><th scope="col" className="text-right">Tickets</th><th scope="col" className="text-right">Umsatz brutto</th></tr></thead>
            <tbody>{punkte.map((p) => <tr key={p.label}><th scope="row" className="!text-sm !normal-case !tracking-normal !font-normal !bg-transparent !text-ink">{p.label}</th><td className="num text-right">{p.tickets}</td><td className="num text-right">{formatEur(p.wert)}</td></tr>)}</tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
