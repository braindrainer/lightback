// Gestaltungssystem des Backends: Seitenkopf, Detailkopf, Kennzahlen, Feldliste, Abschnitt, Leerzustand, Hinweis.
// Interaktive Teile (Menü, Seitenleiste, Rückfrage, Toast, Kopieren) liegen in ui-client.tsx.
import Link from 'next/link';
import { formatEur } from '@/lib/money';
import { Icon } from './icons';
import { Kopieren, Menue, type MenueEintrag } from './ui-client';

export { Icon } from './icons';
export { Bestaetigen, Drawer, Drawer as Seitenleiste, DrawerKnopf, Kopieren, Menue, Modal, toast, ToastBereich, type MenueEintrag } from './ui-client';

export function Money({ cents, className = '', colored = false }: { cents: number; className?: string; colored?: boolean }) {
  const color = colored ? (cents > 0 ? 'text-pos' : cents < 0 ? 'text-neg' : '') : '';
  return <span className={`num whitespace-nowrap ${color} ${className}`}>{formatEur(cents)}</span>;
}

export type Krume = { label: string; href?: string };

/** Brotkrumen „Verkauf › Gutscheine › LOC-…“; der letzte Eintrag ist die aktuelle Seite */
export function Brotkrumen({ krumen }: { krumen: Krume[] }) {
  if (!krumen.length) return null;
  return (
    <nav aria-label="Brotkrumen" className="mb-2">
      <ol className="flex flex-wrap items-center gap-1 text-[13px] text-muted">
        {krumen.map((k, i) => (
          <li key={i} className="flex items-center gap-1">
            {i > 0 && <Icon name="chevron" className="h-3.5 w-3.5 opacity-60" />}
            {k.href && i < krumen.length - 1
              ? <Link href={k.href} className="rounded px-0.5 underline-offset-4 hover:text-ink hover:underline">{k.label}</Link>
              : <span aria-current={i === krumen.length - 1 ? 'page' : undefined} className={i === krumen.length - 1 ? 'font-medium text-ink' : ''}>{k.label}</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** Kopf einer Listen- oder Formularseite */
export function PageHeader({ title, sub, children, krumen }: { title: string; sub?: React.ReactNode; children?: React.ReactNode; krumen?: Krume[] }) {
  return (
    <header className="mb-6">
      {krumen && <Brotkrumen krumen={krumen} />}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="titel">{title}</h1>
          {sub && <div className="mt-1.5 max-w-3xl text-sm text-muted">{sub}</div>}
        </div>
        {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
      </div>
    </header>
  );
}

export type Fakt = { label: string; wert: React.ReactNode };

/** Kopf einer Detailseite: Brotkrumen, Titel, Status, Eckdaten, Aktionen rechts und Menü „⋯“ */
export function DetailKopf({ krumen, titel, mono, status, untertitel, fakten, aktionen, menue, menueLabel = 'Weitere Aktionen' }: {
  krumen: Krume[]; titel: React.ReactNode; mono?: boolean; status?: React.ReactNode; untertitel?: React.ReactNode; fakten?: Fakt[];
  aktionen?: React.ReactNode; menue?: MenueEintrag[]; menueLabel?: string;
}) {
  return (
    <header className="mb-6">
      <Brotkrumen krumen={krumen} />
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className={mono ? 'font-mono text-2xl font-semibold tracking-tight sm:text-[1.75rem]' : 'titel'}>{titel}</h1>
            {status && <div className="flex flex-wrap items-center gap-1.5 [&_.pill]:px-2.5 [&_.pill]:py-1 [&_.pill]:text-xs">{status}</div>}
          </div>
          {untertitel && <div className="mt-1.5 text-sm text-muted">{untertitel}</div>}
        </div>
        {(aktionen || !!menue?.length) && (
          <div className="flex flex-wrap items-center gap-2">
            {aktionen}
            {menue && menue.length > 0 && <Menue label={menueLabel} eintraege={menue} knopfKlasse="btn-secondary !px-2.5" knopf={<><Icon name="mehr" className="h-5 w-5" /><span className="sr-only">{menueLabel}</span></>} />}
          </div>
        )}
      </div>
      {fakten && fakten.length > 0 && (
        <dl className="mt-5 grid grid-cols-2 overflow-hidden rounded-xl border border-line bg-card shadow-karte sm:grid-cols-3 lg:flex">
          {fakten.map((f, i) => (
            <div key={i} className="px-4 py-3 shadow-[1px_1px_0_0_var(--color-line-soft)] lg:min-w-0 lg:flex-1">
              <dt className="text-xs font-medium text-muted">{f.label}</dt>
              <dd className="mt-0.5 text-[15px] font-semibold">{f.wert}</dd>
            </div>
          ))}
        </dl>
      )}
    </header>
  );
}

export type Kennzahl = { label: string; wert: React.ReactNode; hinweis?: React.ReactNode; ton?: 'pos' | 'neg' | 'warn' | 'gold'; icon?: string };

/** Reihe von Kennzahl-Kacheln */
export function Kennzahlen({ items, className = '', titel = 'Kennzahlen' }: { items: Kennzahl[]; className?: string; titel?: string }) {
  const n = items.length;
  const spalten = n >= 6 ? 'sm:grid-cols-3 xl:grid-cols-6' : n === 5 ? 'sm:grid-cols-3 xl:grid-cols-5' : n === 4 ? 'sm:grid-cols-2 xl:grid-cols-4' : n === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2';
  return (
    <section aria-label={titel} className={`mb-6 ${className}`}>
      <dl className={`grid grid-cols-2 gap-3 ${spalten}`}>
        {items.map((k, i) => (
          <div key={i} className={`card relative p-4 md:p-5 ${k.ton === 'gold' ? 'border-gold/70 bg-gradient-to-br from-white to-accent-soft/60' : ''}`}>
            <dt className="flex items-center gap-1.5 text-xs font-medium text-muted">{k.icon && <Icon name={k.icon} className="h-4 w-4" />}{k.label}</dt>
            <dd className={`num mt-1.5 text-2xl font-semibold tracking-tight ${k.ton === 'pos' ? 'text-pos' : k.ton === 'neg' ? 'text-neg' : k.ton === 'warn' ? 'text-warn' : ''}`}>{k.wert}</dd>
            {k.hinweis && <dd className="mt-1 text-xs text-muted">{k.hinweis}</dd>}
          </div>
        ))}
      </dl>
    </section>
  );
}

export type Feld = { label: string; wert: React.ReactNode; kopieren?: string | null; breit?: boolean; mono?: boolean };

/** Definitionsliste: Beschriftung über dem Wert, im Raster mit 2–4 Spalten; Codes/E-Mails kopierbar */
export function Feldliste({ felder, spalten = 3, className = '' }: { felder: (Feld | false | null | undefined | '' | 0)[]; spalten?: 1 | 2 | 3 | 4; className?: string }) {
  const sp = spalten === 4 ? 'grid-cols-2 xl:grid-cols-4' : spalten === 3 ? 'grid-cols-2 lg:grid-cols-3' : spalten === 2 ? 'grid-cols-2' : '';
  return (
    <dl className={`grid gap-x-6 gap-y-4 ${sp} ${className}`}>
      {felder.filter((f): f is Feld => !!f).map((f, i) => (
        <div key={i} className={f.breit ? 'col-span-full' : ''}>
          <dt className="text-xs font-medium text-muted">{f.label}</dt>
          <dd className={`mt-0.5 flex min-w-0 items-center gap-1 text-[15px] ${f.mono ? 'font-mono text-sm' : ''}`}>
            <span className="min-w-0 break-words">{f.wert ?? <span className="text-muted">–</span>}</span>
            {f.kopieren && <Kopieren wert={f.kopieren} label={`${f.label} kopieren`} />}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Karte mit Kopf (Überschrift, Beschreibung, Aktionen). flush: Inhalt ohne Innenabstand (Tabellen). */
export function Abschnitt({ id, titel, beschreibung, aktionen, children, flush, className = '', ebene = 2, tabelleFrei }: {
  id: string; titel: React.ReactNode; beschreibung?: React.ReactNode; aktionen?: React.ReactNode; children: React.ReactNode; flush?: boolean; className?: string; ebene?: 2 | 3; tabelleFrei?: boolean;
}) {
  const H = ebene === 2 ? 'h2' : 'h3';
  return (
    <section aria-labelledby={id} className={`card ${tabelleFrei ? 'tabelle-frei' : ''} ${className}`}>
      <div className={`flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5 pt-4 ${flush ? 'pb-3' : ''}`}>
        <div className="min-w-0">
          <H id={id} className="h2">{titel}</H>
          {beschreibung && <div className="mt-0.5 text-sm text-muted">{beschreibung}</div>}
        </div>
        {aktionen && <div className="flex flex-wrap items-center gap-2">{aktionen}</div>}
      </div>
      <div className={flush ? '' : 'px-5 pb-5 pt-3'}>{children}</div>
    </section>
  );
}

/** Leerer Zustand: Symbol, kurzer Text, optional eine Aktion */
export function LeerZustand({ icon = 'ordner', titel, children, aktion, kompakt }: { icon?: string; titel?: string; children?: React.ReactNode; aktion?: React.ReactNode; kompakt?: boolean }) {
  return (
    <div className={`flex flex-col items-center text-center ${kompakt ? 'px-4 py-7' : 'px-6 py-12'}`}>
      <span aria-hidden="true" className={`grid place-items-center rounded-full bg-accent-soft text-accent-deep ${kompakt ? 'h-10 w-10' : 'h-12 w-12'}`}>
        <Icon name={icon} className={kompakt ? 'h-5 w-5' : 'h-6 w-6'} />
      </span>
      {titel && <p className="mt-3 text-[15px] font-semibold">{titel}</p>}
      {children && <div className={`max-w-md text-sm text-muted ${titel ? 'mt-1' : 'mt-3'}`}>{children}</div>}
      {aktion && <div className="mt-4 flex flex-wrap justify-center gap-2">{aktion}</div>}
    </div>
  );
}

/** Kurzform für Tabellen ohne Treffer */
export function Empty({ children, icon, aktion, titel }: { children?: React.ReactNode; icon?: string; aktion?: React.ReactNode; titel?: string }) {
  return <LeerZustand icon={icon} kompakt aktion={aktion} titel={titel}>{children}</LeerZustand>;
}

const HINWEIS = {
  info: ['border-sky-200 bg-sky-50 text-sky-950', 'info'],
  warn: ['border-amber-200 bg-amber-50 text-amber-950', 'warnung'],
  fehler: ['border-red-200 bg-red-50 text-red-950', 'warnung'],
  ok: ['border-emerald-200 bg-emerald-50 text-emerald-950', 'haken'],
  demo: ['border-violet-200 bg-violet-50 text-violet-950', 'info'],
} as const;

/** Hinweisband über dem Inhalt */
export function Hinweis({ art = 'info', children, titel, rolle, className = 'mb-5', aktion }: { art?: keyof typeof HINWEIS; children: React.ReactNode; titel?: string; rolle?: 'status' | 'alert'; className?: string; aktion?: React.ReactNode }) {
  const [c, i] = HINWEIS[art];
  return (
    <div role={rolle} className={`flex flex-wrap items-start gap-3 rounded-xl border px-4 py-3 text-sm ${c} ${className}`}>
      <Icon name={i} className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">{titel && <p className="font-semibold">{titel}</p>}{children}</div>
      {aktion}
    </div>
  );
}

const STATUS: Record<string, [string, string]> = {
  offen: ['Offen', 'bg-amber-50 text-amber-800 ring-amber-200'],
  bezahlt: ['Bezahlt', 'bg-emerald-50 text-emerald-800 ring-emerald-200'],
  storniert: ['Storniert', 'bg-gray-100 text-gray-700 ring-gray-200'],
  teilstorniert: ['Teilstorniert', 'bg-orange-50 text-orange-800 ring-orange-200'],
  gueltig: ['Gültig', 'bg-emerald-50 text-emerald-800 ring-emerald-200'],
  eingelassen: ['Eingelassen', 'bg-sky-50 text-sky-800 ring-sky-200'],
  verkauf: ['Im Verkauf', 'bg-emerald-50 text-emerald-800 ring-emerald-200'],
  geplant: ['Geplant', 'bg-gray-100 text-gray-700 ring-gray-200'],
  pausiert: ['Verkauf pausiert', 'bg-amber-50 text-amber-800 ring-amber-200'],
  abgesagt: ['Abgesagt', 'bg-red-50 text-red-800 ring-red-200'],
  erstattet: ['Erstattet', 'bg-gray-100 text-gray-700 ring-gray-200'],
  teilerstattet: ['Teilerstattet', 'bg-orange-50 text-orange-800 ring-orange-200'],
  fehlgeschlagen: ['Fehlgeschlagen', 'bg-red-50 text-red-800 ring-red-200'],
  gesendet: ['Gesendet', 'bg-emerald-50 text-emerald-800 ring-emerald-200'],
  demo: ['Demo (nicht gesendet)', 'bg-violet-50 text-violet-800 ring-violet-200'],
  fehler: ['Fehler', 'bg-red-50 text-red-800 ring-red-200'],
  wartet: ['Wartet', 'bg-amber-50 text-amber-800 ring-amber-200'],
};

export function StatusPill({ status, label }: { status: string; label?: string }) {
  const [l, c] = STATUS[status] ?? [status, 'bg-gray-100 text-gray-700 ring-gray-200'];
  return <span className={`pill ring-1 ring-inset ${c}`}><span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />{label ?? l}</span>;
}

/** compare: Vergleichswert (z. B. Vormonat) → Veränderung in %; invert = Anstieg ist schlecht (Ausgaben). */
export function Stat({ label, cents, hint, tone, compare }: { label: string; cents: number; hint?: React.ReactNode; tone?: 'pos' | 'neg'; compare?: { cents: number; label: string; invert?: boolean } }) {
  const d = compare ? cents - compare.cents : 0;
  const pct = compare && compare.cents ? (d / Math.abs(compare.cents)) * 100 : null;
  const good = compare ? (compare.invert ? d <= 0 : d >= 0) : true;
  return (
    <div className="card p-4 md:p-5">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className={`mt-1.5 text-2xl font-semibold tracking-tight num ${tone === 'pos' ? 'text-pos' : tone === 'neg' ? 'text-neg' : ''}`}>{formatEur(cents)}</div>
      {compare && <div className="text-xs mt-1 flex flex-wrap items-center gap-1.5" title={`${compare.label}: ${formatEur(compare.cents)}`}>
        <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 font-medium ${d === 0 ? 'bg-gray-100 text-gray-700' : good ? 'bg-emerald-50 text-pos' : 'bg-red-50 text-neg'}`}>{d > 0 ? '▲' : d < 0 ? '▼' : '='} {pct == null ? '—' : `${Math.abs(pct).toLocaleString('de-AT', { maximumFractionDigits: 1 })} %`}</span>
        <span className="text-muted">vs. {compare.label} <span className="num">{formatEur(compare.cents)}</span></span>
      </div>}
      {hint && <div className="text-xs text-muted mt-1">{hint}</div>}
    </div>
  );
}

/** Fortschrittsbalken mit Textalternative (z. B. Restwert eines Gutscheins) */
export function Fortschritt({ wert, max, label, text, ton = 'gold', className = 'h-2 bg-line' }: { wert: number; max: number; label: string; text?: string; ton?: 'gold' | 'pos' | 'nacht'; className?: string }) {
  const pct = max ? Math.max(0, Math.min(100, (wert / max) * 100)) : 0;
  const farbe = ton === 'pos' ? 'bg-pos' : ton === 'nacht' ? 'bg-nacht' : 'bg-gold';
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-valuetext={text} className={`overflow-hidden rounded-full ${className}`}>
      <div className={`h-full rounded-full ${farbe}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Schnellfilter als Chips (Links) – aktive Chips sind mit aria-current markiert */
export function FilterChips({ label, chips }: { label: string; chips: { label: string; href: string; aktiv: boolean; anzahl?: number }[] }) {
  return (
    <nav aria-label={label} className="flex flex-wrap gap-1.5">
      {chips.map((c) => (
        <Link key={c.label} href={c.href} aria-current={c.aktiv ? 'true' : undefined} className="chip" scroll={false}>
          {c.aktiv && <Icon name="haken" className="h-3.5 w-3.5" />}{c.label}
          {c.anzahl != null && <span className="num text-[11px] opacity-70">{c.anzahl}</span>}
        </Link>
      ))}
    </nav>
  );
}
