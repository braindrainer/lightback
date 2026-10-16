// Gutschein als Markenkarte (Nachtblau/Gold) mit QR-Code des Codes – Detailseite und Druck (A6)
import { fmtDatum } from '@/lib/dates';
import { formatEur } from '@/lib/money';
import { qrSvg } from '@/lib/tickets';

export type GutscheinDaten = { code: string; valueCents: number; remainingCents: number; validUntil: Date | null; kind: string; issuer: string; active: boolean };

export function gutscheinZustand(v: GutscheinDaten): { key: 'aktiv' | 'inaktiv' | 'abgelaufen' | 'aufgebraucht'; text: string } {
  if (!v.active) return { key: 'inaktiv', text: 'Deaktiviert' };
  if (v.validUntil && v.validUntil < new Date()) return { key: 'abgelaufen', text: 'Abgelaufen' };
  if (v.remainingCents === 0) return { key: 'aufgebraucht', text: 'Aufgebraucht' };
  return { key: 'aktiv', text: 'Einlösbar' };
}

export default async function GutscheinKarte({ v, druck }: { v: GutscheinDaten; druck?: boolean }) {
  const svg = (await qrSvg(v.code)).replace('<svg ', '<svg aria-hidden="true" focusable="false" ');
  const z = gutscheinZustand(v);
  const pct = v.valueCents ? Math.round((v.remainingCents / v.valueCents) * 100) : 0;
  const teil = v.remainingCents !== v.valueCents;
  return (
    <figure aria-label={`Gutschein ${v.code}, Restwert ${formatEur(v.remainingCents)} von ${formatEur(v.valueCents)}`}
      className={`relative m-0 overflow-hidden text-[#f4efe6] ${druck ? 'flex h-full flex-col rounded-none p-[9mm]' : 'rounded-2xl p-6 shadow-schwebend sm:p-8'}`}
      style={{ background: 'radial-gradient(120% 90% at 100% 0%, #1b2742 0%, #0c1322 45%, #070b14 100%)' }}>
      <div aria-hidden="true" className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full border border-gold/15" />
      <div aria-hidden="true" className="pointer-events-none absolute -right-10 -top-10 h-44 w-44 rounded-full border border-gold/20" />
      <div className={`relative flex ${druck ? 'flex-1 flex-col' : 'flex-col gap-6 sm:flex-row sm:items-stretch sm:justify-between'}`}>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between gap-3">
            <img src="/img/logo-wortmarke.svg" alt="" className={druck ? 'h-12 w-auto' : 'h-10 w-auto'} />
            {z.key !== 'aktiv' && <span className="rounded-full border border-[#ff9b93]/60 bg-[#3a1514] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-[#ffc4be]">{z.text}</span>}
          </div>
          <p className={`text-[11px] font-semibold uppercase tracking-[0.28em] text-gold ${druck ? 'mt-[8mm]' : 'mt-6'}`}>{v.kind === 'partner' ? `Gutschein · ${v.issuer}` : 'Gutschein'}</p>
          <p className={`num font-marke font-semibold leading-none text-gold-hell ${druck ? 'mt-2 text-[44pt]' : 'mt-2 text-6xl sm:text-7xl'}`}>{formatEur(v.remainingCents)}</p>
          <div className={druck ? 'mt-3' : 'mt-4 max-w-sm'}>
            <div className="flex items-baseline justify-between text-[13px] text-[#c4bfb3]">
              <span>{teil ? <>Restwert von {formatEur(v.valueCents)}</> : 'Voller Wert'}</span>
              <span className="num">{pct} %</span>
            </div>
            {druck ? <div aria-hidden="true" className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/15"><div className="h-full rounded-full bg-gold" style={{ width: `${pct}%` }} /></div>
              : <div role="progressbar" aria-label="Restwert" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-valuetext={`${formatEur(v.remainingCents)} von ${formatEur(v.valueCents)}`}
                className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/15"><div className="h-full rounded-full bg-gold" style={{ width: `${pct}%` }} /></div>}
          </div>
          {druck && <div className="mx-auto my-auto h-[40mm] w-[40mm] rounded-lg bg-white p-1.5 [&_svg]:block [&_svg]:h-full [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />}
          <div className={`grid grid-cols-[minmax(0,1fr)_auto] gap-4 border-t border-dashed border-[#2a3654] ${druck ? 'pt-[5mm]' : 'mt-6 pt-5'}`}>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#c4bfb3]">Code</p>
              <p className="mt-1 break-all font-mono text-base font-semibold tracking-[0.06em] text-white sm:text-lg sm:tracking-[0.12em]">{v.code}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#c4bfb3]">Gültig bis</p>
              <p className="mt-1 text-lg font-semibold text-white">{v.validUntil ? fmtDatum(v.validUntil) : 'unbefristet'}</p>
            </div>
          </div>
        </div>
        {!druck && <div className="h-40 w-40 shrink-0 self-center rounded-xl bg-white p-2.5 sm:h-44 sm:w-44 [&_svg]:block [&_svg]:h-full [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />}
      </div>
    </figure>
  );
}
