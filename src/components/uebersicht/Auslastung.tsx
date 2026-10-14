import Link from 'next/link';

export type ShowBalken = { id: string; label: string; kurz: string; verkauft: number; eingelassen: number; reserviert: number; gesperrt: number; kapazitaet: number };

/** Gestapelte Säulen je Vorstellung: verkauft (davon eingelassen), reserviert, gesperrt, frei. Tabelle als Alternative. */
export function Auslastung({ shows }: { shows: ShowBalken[] }) {
  const W = 760, H = 220, L = 40, R = 8, T = 10, B = 34;
  const n = Math.max(1, shows.length);
  const breite = (W - L - R) / n;
  const y = (pct: number) => T + (H - T - B) * (1 - pct);
  const teil = (s: ShowBalken, v: number) => v / Math.max(1, s.kapazitaet);
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-labelledby="ausl-t ausl-d">
        <title id="ausl-t">Auslastung der nächsten Vorstellungen</title>
        <desc id="ausl-d">{shows.length} Vorstellungen, Anteil verkaufter, reservierter und gesperrter Plätze. Die Zahlen stehen in der Tabelle darunter.</desc>
        {[0, 0.25, 0.5, 0.75, 1].map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="#e3dccd" />
            <text x={L - 6} y={y(v) + 4} textAnchor="end" fontSize="11" fill="#59617a">{v * 100} %</text>
          </g>
        ))}
        {shows.map((s, i) => {
          const x = L + i * breite + breite * 0.18, w = Math.max(2, breite * 0.64);
          const v = teil(s, s.verkauft), r = teil(s, s.reserviert), g = teil(s, s.gesperrt);
          return (
            <g key={s.id}>
              <rect x={x} y={y(1)} width={w} height={y(0) - y(1)} fill="#f1ebdf" rx="3" />
              <rect x={x} y={y(v)} width={w} height={y(0) - y(v)} fill="#8a6a1f" rx="3" />
              {s.eingelassen > 0 && <rect x={x} y={y(teil(s, s.eingelassen))} width={w} height={y(0) - y(teil(s, s.eingelassen))} fill="#4c3a10" rx="3" />}
              <rect x={x} y={y(v + r)} width={w} height={y(v) - y(v + r)} fill="#d9b877" />
              <rect x={x} y={y(v + r + g)} width={w} height={y(v + r) - y(v + r + g)} fill="#9aa1b3" />
              <title>{`${s.label}: ${s.verkauft} verkauft, ${s.reserviert} reserviert, ${s.gesperrt} gesperrt, ${s.kapazitaet - s.verkauft - s.reserviert - s.gesperrt} frei`}</title>
              {(i % Math.ceil(n / 14) === 0) && <text x={x + w / 2} y={H - 18} textAnchor="middle" fontSize="11" fill="#59617a">{s.kurz.split(' ')[0]}</text>}
              {(i % Math.ceil(n / 14) === 0) && <text x={x + w / 2} y={H - 5} textAnchor="middle" fontSize="10" fill="#59617a">{s.kurz.split(' ')[1]}</text>}
            </g>
          );
        })}
        <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} stroke="#59617a" />
      </svg>
      <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted" aria-label="Legende">
        {[['#4c3a10', 'eingelassen'], ['#8a6a1f', 'verkauft'], ['#d9b877', 'reserviert'], ['#9aa1b3', 'gesperrt'], ['#f1ebdf', 'frei']].map(([c, t]) => (
          <li key={t} className="flex items-center gap-1.5"><span aria-hidden="true" className="h-3 w-3 rounded-sm border border-line" style={{ background: c }} />{t}</li>
        ))}
      </ul>
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer py-1 font-medium text-accent-deep underline underline-offset-4">Daten als Tabelle</summary>
        <div className="mt-2 max-h-80 overflow-auto">
          <table className="table">
            <caption className="sr-only">Auslastung der nächsten Vorstellungen</caption>
            <thead><tr><th scope="col">Vorstellung</th><th scope="col" className="text-right">Verkauft</th><th scope="col" className="text-right">Reserviert</th><th scope="col" className="text-right">Gesperrt</th><th scope="col" className="text-right">Frei</th></tr></thead>
            <tbody>{shows.map((s) => <tr key={s.id}><td><Link href={`/vorstellungen/${s.id}`} className="underline-offset-4 hover:underline">{s.label}</Link></td><td className="num text-right">{s.verkauft}</td><td className="num text-right">{s.reserviert}</td><td className="num text-right">{s.gesperrt}</td><td className="num text-right">{s.kapazitaet - s.verkauft - s.reserviert - s.gesperrt}</td></tr>)}</tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
