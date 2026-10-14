// Verlauf eines Datensatzes aus dem revisionssicheren Protokoll: wer hat wann was geändert.
import Link from 'next/link';
import type { AuditLog } from '@prisma/client';
import { bereiche } from '@/lib/audit';
import { aktionName, bereichLink, bereichName, feldName, wertText } from '@/lib/audit-texte';
import { db } from '@/lib/db';
import { fmtDatum } from '@/lib/dates';
import { Icon } from './icons';
import { LeerZustand } from './ui';

const zeit = (d: Date) => new Intl.DateTimeFormat('de-AT', { timeZone: 'Europe/Vienna', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(d);
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});

/** Tabelle der geänderten Felder (vorher → nachher). Bei reinen Neuanlagen nur „Neu“. */
export function Aenderungen({ vorher, nachher, beschriftung = 'Geänderte Felder' }: { vorher: unknown; nachher: unknown; beschriftung?: string }) {
  const a = obj(vorher);
  const b = obj(nachher);
  const felder = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  if (!felder.length) return null;
  const nurNeu = !Object.keys(a).length;
  return (
    <table className="mt-2 w-full table-fixed text-xs">
      <caption className="sr-only">{beschriftung}</caption>
      <thead><tr className="text-left text-muted"><th scope="col" className="py-1 pr-3 font-semibold">Feld</th>{!nurNeu && <th scope="col" className="py-1 pr-3 font-semibold">Vorher</th>}<th scope="col" className="py-1 font-semibold">{nurNeu ? 'Wert' : 'Nachher'}</th></tr></thead>
      <tbody>
        {felder.map((f) => (
          <tr key={f} className="border-t border-line/70 align-top">
            <th scope="row" className="relative py-1 pr-3 text-left font-medium break-words">{feldName(f)}</th>
            {!nurNeu && <td className="relative py-1 pr-3 break-words text-muted"><span className="sr-only">vorher: </span>{f in a ? <del className="decoration-neg/60">{wertText(f, a[f])}</del> : '–'}</td>}
            <td className="relative py-1 break-words"><span className="sr-only">{nurNeu ? '' : 'nachher: '}</span>{f in b ? <ins className="no-underline font-medium">{wertText(f, b[f])}</ins> : '–'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Zusatzdaten eines Eintrags als Liste */
export function Daten({ data }: { data: unknown }) {
  const d = obj(data);
  const k = Object.keys(d).filter((x) => d[x] !== null && d[x] !== undefined);
  if (!k.length) return null;
  return (
    <dl className="mt-2 grid gap-x-3 gap-y-0.5 text-xs sm:grid-cols-[minmax(7rem,auto)_1fr]">
      {k.map((x) => <div key={x} className="contents"><dt className="text-muted">{feldName(x)}</dt><dd className="break-words">{wertText(x, d[x])}</dd></div>)}
    </dl>
  );
}

/** Art einer Aktion → Symbol und Farbe in der Zeitleiste */
export function aktionArt(a: string): { icon: string; ton: string } {
  const t = (icon: string, ton: string) => ({ icon, ton });
  if (/storn|absag|abbruch|verwerf|verfall|deaktiv|fehl|abgelehnt|gesperrt|verweiger/.test(a)) return t(/fehl|abgelehnt|gesperrt/.test(a) ? 'warnung' : 'storno', 'bg-red-50 text-neg ring-red-200');
  if (/bezahlt|zahlung|kassa_verkauf|auszahlung/.test(a)) return t('euro', 'bg-emerald-50 text-pos ring-emerald-200');
  if (/mail|senden|gesendet|webhook|nachricht/.test(a)) return t('mail', 'bg-sky-50 text-sky-800 ring-sky-200');
  if (/einlass/.test(a)) return t('scan', 'bg-sky-50 text-sky-800 ring-sky-200');
  if (/umbuch|umsetz/.test(a)) return t('umbuchen', 'bg-violet-50 text-violet-800 ring-violet-200');
  if (/login|logout|passwort/.test(a)) return t('login', 'bg-gray-100 text-gray-700 ring-gray-200');
  if (/gutschein/.test(a)) return t('gutschein', 'bg-accent-soft text-accent-deep ring-gold/50');
  if (/rechnung|beleg|buchung|uva|export/.test(a)) return t('rechnung', 'bg-accent-soft text-accent-deep ring-gold/50');
  if (/druck/.test(a)) return t('druck', 'bg-gray-100 text-gray-700 ring-gray-200');
  if (/bearbeit|geaendert|aendern|notiz|kunde|einstellung|vorlage|sperr/.test(a)) return t('bearbeiten', 'bg-paper-deep text-ink ring-line');
  return t('plus', 'bg-accent-soft text-accent-deep ring-gold/50');
}

/** Änderungen als Chips „Feld: vorher → nachher“ */
export function DiffChips({ vorher, nachher, beschriftung }: { vorher: unknown; nachher: unknown; beschriftung: string }) {
  const a = obj(vorher);
  const b = obj(nachher);
  const felder = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  if (!felder.length) return null;
  const nurNeu = !Object.keys(a).length;
  return (
    <ul aria-label={beschriftung} className="mt-2 flex flex-wrap gap-1.5">
      {felder.map((f) => (
        <li key={f} className="inline-flex max-w-full flex-wrap items-baseline gap-x-1.5 rounded-lg border border-line-soft bg-[#fbf9f5] px-2 py-1 text-xs">
          <span className="font-semibold text-muted">{feldName(f)}:</span>
          {!nurNeu && <><span className="sr-only">vorher</span><del className="break-all text-muted decoration-neg/60">{f in a ? wertText(f, a[f]) : '–'}</del><span aria-hidden="true" className="text-muted">→</span><span className="sr-only">nachher</span></>}
          <ins className="break-all font-medium no-underline">{f in b ? wertText(f, b[f]) : '–'}</ins>
        </li>
      ))}
    </ul>
  );
}

export function EintragZeile({ e, haupt }: { e: AuditLog; haupt?: string }) {
  const fremd = haupt !== `${e.entity}:${e.entityId}`;
  const link = bereichLink(e.entity, e.entityId);
  const art = aktionArt(e.action);
  const daten = obj(e.data);
  return (
    <li className="relative grid grid-cols-[2rem_1fr] gap-x-3 pb-5 last:pb-0">
      <span aria-hidden="true" className="absolute left-4 top-8 bottom-0 w-px bg-line [li:last-child>&]:hidden" />
      <span aria-hidden="true" className={`relative z-[1] grid h-8 w-8 place-items-center rounded-full ring-1 ring-inset ${art.ton}`}><Icon name={art.icon} className="h-4 w-4" /></span>
      <div className="min-w-0 pt-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
          <strong className="font-semibold">{aktionName(e.action)}</strong>
          {fremd && <span className="pill bg-paper-deep text-muted">{bereichName(e.entity)}{e.entityId && link ? <> · <Link href={link} className="underline underline-offset-2">öffnen<span className="sr-only">: {bereichName(e.entity)}</span></Link></> : ''}</span>}
        </div>
        <p className="mt-0.5 text-xs text-muted">
          <span className="font-medium text-ink/80">{e.userName ?? 'System'}</span> · <time dateTime={e.createdAt.toISOString()} className="num">{fmtDatum(e.createdAt)}, {zeit(e.createdAt)}</time>
        </p>
        <DiffChips vorher={e.vorher} nachher={e.nachher} beschriftung={`Änderungen: ${aktionName(e.action)}`} />
        <details className="mt-1.5">
          <summary className="relative inline-flex min-h-6 cursor-pointer items-center text-xs text-accent-deep underline underline-offset-2">Details<span className="sr-only"> zu {aktionName(e.action)}</span></summary>
          {Object.keys(daten).length > 0 && <Daten data={e.data} />}
          <p className="mt-1 text-[11px] text-muted">Eintrag Nr. {e.seq}{e.ip ? ` · IP ${e.ip}` : ''} · Hash <code className="font-mono">{e.hash?.slice(0, 12) ?? '–'}</code></p>
        </details>
      </div>
    </li>
  );
}

export type Ziel = { entity: string; ids: (string | null | undefined)[] };

/** Verlauf aus dem Protokoll; ziele[0] ist der Hauptdatensatz, weitere (Tickets, Rechnungen …) werden mit angezeigt */
export async function Verlauf({ ziele, titel = 'Verlauf', id = 'verlauf', max = 400, className = '' }: { ziele: Ziel[]; titel?: string; id?: string; max?: number; className?: string }) {
  const or = ziele.map((z) => ({ entity: { in: bereiche(z.entity) }, entityId: { in: z.ids.filter((x): x is string => !!x) } })).filter((z) => z.entityId.in.length);
  const eintraege = or.length ? await db.auditLog.findMany({ where: { OR: or }, orderBy: { seq: 'desc' }, take: max }) : [];
  eintraege.reverse();
  const h = ziele[0];
  const haupt = h ? `${h.entity}:${h.ids[0]}` : undefined;
  return (
    <section className={`card p-5 ${className}`} aria-labelledby={id}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={id} className="h2">{titel}</h2>
        <p className="text-xs text-muted">Revisionssicheres Protokoll, älteste zuerst{eintraege.length >= max ? ` (letzte ${max})` : ''}</p>
      </div>
      {eintraege.length ? <ol className="mt-5">{eintraege.map((e) => <EintragZeile key={e.id} e={{ ...e, entity: e.entity.charAt(0).toLowerCase() + e.entity.slice(1) }} haupt={haupt} />)}</ol>
        : <LeerZustand kompakt icon="uhr">Noch keine Einträge.</LeerZustand>}
    </section>
  );
}
