import Link from 'next/link';
import { Prisma } from '@prisma/client';
import { requireRole } from '@/lib/auth';
import { db } from '@/lib/db';
import { fmtDatum } from '@/lib/dates';
import { Empty, Icon, Money, PageHeader } from '@/components/ui';
import { Seiten } from '@/components/verkauf/Seiten';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Kund:innen' };
const PRO_SEITE = 50;

type Zeile = { schluessel: string; id: string; vorname: string; nachname: string; email: string; telefon: string | null; firma: string | null; newsletter: boolean; bestellungen: number; umsatz: number; zuletzt: Date | null };

export default async function Kunden({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireRole('leitung');
  const sp = await searchParams;
  const q = (sp.q ?? '').trim();
  const nl = sp.newsletter === 'ja';
  const seite = Math.max(1, Number(sp.seite) || 1);
  const muster = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const filter = Prisma.sql`WHERE c."firstName" <> 'Anonymisiert'
    ${q ? Prisma.sql`AND (c.email ILIKE ${muster} OR c."firstName" ILIKE ${muster} OR c."lastName" ILIKE ${muster} OR (c."firstName" || ' ' || c."lastName") ILIKE ${muster} OR c.phone ILIKE ${muster} OR c.company ILIKE ${muster})` : Prisma.empty}
    ${nl ? Prisma.sql`AND c.newsletter` : Prisma.empty}`;
  // Eine Person = gleiche E-Mail (der Shop legt je Bestellung einen Datensatz an); ohne E-Mail je Datensatz
  const gruppe = Prisma.sql`coalesce(nullif(lower(c.email), ''), c.id)`;
  const [zeilen, gesamt] = await Promise.all([
    db.$queryRaw<Zeile[]>`
      SELECT ${gruppe} AS schluessel,
        (array_agg(c.id ORDER BY c."createdAt" DESC))[1] AS id,
        (array_agg(c."firstName" ORDER BY c."createdAt" DESC))[1] AS vorname,
        (array_agg(c."lastName" ORDER BY c."createdAt" DESC))[1] AS nachname,
        max(c.email) AS email, max(c.phone) AS telefon, max(c.company) AS firma, bool_or(c.newsletter) AS newsletter,
        count(DISTINCT o.id)::int AS bestellungen,
        coalesce(sum(t."priceCents") FILTER (WHERE t.status <> 'storniert'), 0)::int AS umsatz,
        max(o."createdAt") AS zuletzt
      FROM "Customer" c
      LEFT JOIN "Order" o ON o."customerId" = c.id
      LEFT JOIN "Ticket" t ON t."orderId" = o.id
      ${filter}
      GROUP BY 1 ORDER BY max(o."createdAt") DESC NULLS LAST, 1
      LIMIT ${PRO_SEITE} OFFSET ${(seite - 1) * PRO_SEITE}`,
    db.$queryRaw<{ n: number }[]>`SELECT count(DISTINCT ${gruppe})::int AS n FROM "Customer" c ${filter}`,
  ]);
  const anzahl = gesamt[0]?.n ?? 0;
  return (
    <>
      <PageHeader title="Kund:innen" krumen={[{ label: 'Verkauf' }, { label: 'Kund:innen' }]} sub={<><span className="num font-semibold text-ink">{anzahl.toLocaleString('de-AT')}</span> Personen, zusammengefasst nach E-Mail-Adresse</>} />
      <form method="get" role="search" aria-label="Kund:innen suchen" className="card mb-4 flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-60 flex-1"><label htmlFor="q" className="label">Suche</label><div className="relative"><Icon name="suche" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" /><input id="q" name="q" type="search" defaultValue={q} placeholder="Name, E-Mail, Telefon, Firma" className="input !pl-9" /></div></div>
        <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" name="newsletter" value="ja" defaultChecked={nl} className="h-4 w-4 accent-accent" />Nur Newsletter</label>
        <button className="btn-primary">Suchen</button>
      </form>
      <section className="card tabelle-frei" aria-label="Ergebnisse">
        {zeilen.length ? (
          <table className="table rtab">
            <caption className="sr-only">Kund:innen mit Bestellungen und Umsatz</caption>
            <thead><tr><th scope="col">Name</th><th scope="col">E-Mail</th><th scope="col">Telefon</th><th scope="col">Newsletter</th><th scope="col" className="text-right">Bestellungen</th><th scope="col" className="text-right">Umsatz</th><th scope="col">Zuletzt</th></tr></thead>
            <tbody>{zeilen.map((z) => (
              <tr key={z.schluessel}>
                <td className="rtab-kopf"><Link href={`/kunden/${z.id}`} className="font-semibold underline-offset-4 hover:underline">{`${z.vorname} ${z.nachname}`.trim() || '(ohne Namen)'}</Link>{z.firma && <span className="block text-xs text-muted">{z.firma}</span>}</td>
                <td data-label="E-Mail" className="break-all">{z.email || <span className="text-muted">–</span>}</td><td data-label="Telefon" className="whitespace-nowrap">{z.telefon ?? <span className="text-muted">–</span>}</td><td data-label="Newsletter">{z.newsletter ? <span className="pill bg-accent-soft text-accent-deep">Ja</span> : <span className="text-muted">Nein</span>}</td>
                <td data-label="Bestellungen" className="num text-right">{z.bestellungen}</td><td data-label="Umsatz" className="text-right font-medium"><Money cents={z.umsatz} /></td><td data-label="Zuletzt" className="whitespace-nowrap">{z.zuletzt ? fmtDatum(z.zuletzt) : '–'}</td>
              </tr>
            ))}</tbody>
          </table>
        ) : <Empty icon="kunden" titel="Keine Kund:innen gefunden" aktion={q || nl ? <Link href="/kunden" className="btn-secondary btn-sm">Suche zurücksetzen</Link> : undefined}>Kund:innen entstehen mit jeder Bestellung mit Namen oder E-Mail.</Empty>}
        <Seiten seite={seite} seiten={Math.ceil(anzahl / PRO_SEITE)} basis="/kunden" params={{ q: q || undefined, newsletter: nl ? 'ja' : undefined }} gesamt={anzahl} pro={PRO_SEITE} />
      </section>
    </>
  );
}
