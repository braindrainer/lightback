// Verlauf eines Datensatzes aus dem revisionssicheren Protokoll: wer hat wann was geändert.
import Link from 'next/link';
import type { AuditLog } from '@prisma/client';
import { bereiche } from '@/lib/audit';
import { aktionName, bereichLink, bereichName, feldName, wertText } from '@/lib/audit-texte';
import { db } from '@/lib/db';
import { fmtDatum } from '@/lib/dates';

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

export function EintragZeile({ e, haupt }: { e: AuditLog; haupt?: string }) {
  const fremd = haupt !== `${e.entity}:${e.entityId}`;
  const link = bereichLink(e.entity, e.entityId);
  const hatDiff = Object.keys(obj(e.vorher)).length + Object.keys(obj(e.nachher)).length > 0;
  return (
    <li className="relative border-l-2 border-line pb-4 pl-4 last:pb-0">
      <span aria-hidden="true" className="absolute -left-[5px] top-1.5 h-2 w-2 rounded-full bg-accent" />
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
        <time dateTime={e.createdAt.toISOString()} className="num whitespace-nowrap text-muted">{fmtDatum(e.createdAt)}, {zeit(e.createdAt)}</time>
        <strong className="font-semibold">{aktionName(e.action)}</strong>
        {fremd && <span className="text-xs text-muted">({bereichName(e.entity)}{e.entityId && link ? <> <Link href={link} className="underline underline-offset-2">öffnen</Link></> : ''})</span>}
        <span className="text-muted">· {e.userName ?? 'System'}</span>
      </div>
      {hatDiff && <Aenderungen vorher={e.vorher} nachher={e.nachher} beschriftung={`Änderungen: ${aktionName(e.action)}`} />}
      {(
        <details className="mt-1">
          <summary className="relative inline-flex min-h-6 cursor-pointer items-center text-xs text-accent-deep underline underline-offset-2">Details<span className="sr-only"> zu {aktionName(e.action)}</span></summary>
          <Daten data={e.data} />
          <p className="mt-1 text-[11px] text-muted">Eintrag Nr. {e.seq}{e.ip ? ` · IP ${e.ip}` : ''} · Hash <code className="font-mono">{e.hash?.slice(0, 12) ?? '–'}</code></p>
        </details>
      )}
    </li>
  );
}

export type Ziel = { entity: string; ids: (string | null | undefined)[] };

/** Verlauf aus dem Protokoll; ziele[0] ist der Hauptdatensatz, weitere (Tickets, Rechnungen …) werden mit angezeigt */
export async function Verlauf({ ziele, titel = 'Verlauf', id = 'verlauf', max = 400 }: { ziele: Ziel[]; titel?: string; id?: string; max?: number }) {
  const or = ziele.map((z) => ({ entity: { in: bereiche(z.entity) }, entityId: { in: z.ids.filter((x): x is string => !!x) } })).filter((z) => z.entityId.in.length);
  const eintraege = or.length ? await db.auditLog.findMany({ where: { OR: or }, orderBy: { seq: 'desc' }, take: max }) : [];
  eintraege.reverse();
  const h = ziele[0];
  const haupt = h ? `${h.entity}:${h.ids[0]}` : undefined;
  return (
    <section className="card mb-6 p-5" aria-labelledby={id}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={id} className="h2">{titel}</h2>
        <p className="text-xs text-muted">Aus dem revisionssicheren Protokoll, älteste zuerst{eintraege.length >= max ? ` (letzte ${max})` : ''}</p>
      </div>
      {eintraege.length ? <ol className="mt-4">{eintraege.map((e) => <EintragZeile key={e.id} e={{ ...e, entity: e.entity.charAt(0).toLowerCase() + e.entity.slice(1) }} haupt={haupt} />)}</ol>
        : <p className="mt-3 text-sm text-muted">Noch keine Einträge.</p>}
    </section>
  );
}
