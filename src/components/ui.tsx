import { formatEur } from '@/lib/money';

export function Money({ cents, className = '', colored = false }: { cents: number; className?: string; colored?: boolean }) {
  const color = colored ? (cents > 0 ? 'text-pos' : cents < 0 ? 'text-neg' : '') : '';
  return <span className={`num whitespace-nowrap ${color} ${className}`}>{formatEur(cents)}</span>;
}

export function PageHeader({ title, sub, children }: { title: string; sub?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
      <div>
        <h1 className="h1">{title}</h1>
        {sub && <p className="text-sm text-muted mt-0.5">{sub}</p>}
      </div>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}

const STATUS: Record<string, [string, string]> = {
  offen: ['Offen', 'bg-amber-50 text-amber-800'],
  bezahlt: ['Bezahlt', 'bg-emerald-50 text-emerald-800'],
  storniert: ['Storniert', 'bg-gray-100 text-gray-600 line-through'],
  teilstorniert: ['Teilstorniert', 'bg-orange-50 text-orange-800'],
  gueltig: ['Gültig', 'bg-emerald-50 text-emerald-800'],
  eingelassen: ['Eingelassen', 'bg-sky-50 text-sky-800'],
  verkauf: ['Im Verkauf', 'bg-emerald-50 text-emerald-800'],
  geplant: ['Geplant', 'bg-gray-100 text-gray-700'],
  pausiert: ['Verkauf pausiert', 'bg-amber-50 text-amber-800'],
  abgesagt: ['Abgesagt', 'bg-red-50 text-red-800'],
  erstattet: ['Erstattet', 'bg-gray-100 text-gray-700'],
  teilerstattet: ['Teilerstattet', 'bg-orange-50 text-orange-800'],
  fehlgeschlagen: ['Fehlgeschlagen', 'bg-red-50 text-red-800'],
  gesendet: ['Gesendet', 'bg-emerald-50 text-emerald-800'],
  demo: ['Demo (nicht gesendet)', 'bg-violet-50 text-violet-800'],
  fehler: ['Fehler', 'bg-red-50 text-red-800'],
  wartet: ['Wartet', 'bg-amber-50 text-amber-800'],
};

export function StatusPill({ status, label }: { status: string; label?: string }) {
  const [l, c] = STATUS[status] ?? [status, 'bg-gray-100 text-gray-600'];
  return <span className={`pill ${c}`}>{label ?? l}</span>;
}

/** compare: Vergleichswert (z. B. Vormonat) → Veränderung in %; invert = Anstieg ist schlecht (Ausgaben). */
export function Stat({ label, cents, hint, tone, compare }: { label: string; cents: number; hint?: React.ReactNode; tone?: 'pos' | 'neg'; compare?: { cents: number; label: string; invert?: boolean } }) {
  const d = compare ? cents - compare.cents : 0;
  const pct = compare && compare.cents ? (d / Math.abs(compare.cents)) * 100 : null;
  const good = compare ? (compare.invert ? d <= 0 : d >= 0) : true;
  return (
    <div className="card p-4 md:p-5">
      <div className="text-xs text-muted">{label}</div>
      <div className={`text-2xl font-semibold mt-1 num ${tone === 'pos' ? 'text-pos' : tone === 'neg' ? 'text-neg' : ''}`}>{formatEur(cents)}</div>
      {compare && <div className="text-xs mt-1 flex flex-wrap items-center gap-1.5" title={`${compare.label}: ${formatEur(compare.cents)}`}>
        <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 font-medium ${d === 0 ? 'bg-gray-100 text-gray-600' : good ? 'bg-emerald-50 text-pos' : 'bg-red-50 text-neg'}`}>{d > 0 ? '▲' : d < 0 ? '▼' : '='} {pct == null ? '—' : `${Math.abs(pct).toLocaleString('de-AT', { maximumFractionDigits: 1 })} %`}</span>
        <span className="text-muted">vs. {compare.label} <span className="num">{formatEur(compare.cents)}</span></span>
      </div>}
      {hint && <div className="text-xs text-muted mt-1">{hint}</div>}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-center text-sm text-muted py-12">{children}</div>;
}
