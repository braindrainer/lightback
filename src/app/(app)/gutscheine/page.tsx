import Link from 'next/link';
import type { Prisma } from '@prisma/client';
import { requireRole } from '@/lib/auth';
import { db } from '@/lib/db';
import { fmtDatum } from '@/lib/dates';
import { Empty, FilterChips, Icon, Kennzahlen, PageHeader, StatusPill } from '@/components/ui';
import { formatEur } from '@/lib/money';
import { Seiten } from '@/components/verkauf/Seiten';
import { ISSUER_NAME } from '@/components/verkauf/texte';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Gutscheine' };
const PRO_SEITE = 50;
const ZUSTAND = [['aktiv', 'Einlösbar'], ['eingeloest', 'Aufgebraucht'], ['inaktiv', 'Deaktiviert'], ['abgelaufen', 'Abgelaufen'], ['alle', 'Alle']] as const;

export default async function Gutscheine({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireRole('leitung', 'buchhaltung');
  const sp = await searchParams;
  const q = (sp.q ?? '').trim().toUpperCase();
  const zustand = ZUSTAND.some(([k]) => k === sp.zustand) ? sp.zustand! : 'aktiv';
  const seite = Math.max(1, Number(sp.seite) || 1);
  const jetzt = new Date();
  const and: Prisma.VoucherWhereInput[] = [];
  if (q) and.push({ OR: [{ code: { contains: q } }, { note: { contains: sp.q!.trim(), mode: 'insensitive' } }] });
  if (sp.issuer) and.push({ issuer: sp.issuer });
  if (zustand === 'aktiv') and.push({ active: true, remainingCents: { gt: 0 }, OR: [{ validUntil: null }, { validUntil: { gt: jetzt } }] });
  if (zustand === 'eingeloest') and.push({ remainingCents: 0 });
  if (zustand === 'inaktiv') and.push({ active: false });
  if (zustand === 'abgelaufen') and.push({ validUntil: { lt: jetzt } });
  const where = { AND: and };
  const [anzahl, liste, issuer, summe, aktivAnzahl, eingeloest] = await Promise.all([
    db.voucher.count({ where }),
    db.voucher.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (seite - 1) * PRO_SEITE, take: PRO_SEITE, include: { _count: { select: { redemptions: true } } } }),
    db.voucher.groupBy({ by: ['issuer'], _count: { _all: true } }),
    db.voucher.aggregate({ where: { kind: 'wert', active: true, remainingCents: { gt: 0 } }, _sum: { remainingCents: true } }),
    db.voucher.count({ where: { active: true, remainingCents: { gt: 0 }, OR: [{ validUntil: null }, { validUntil: { gt: jetzt } }] } }),
    db.voucherRedemption.aggregate({ where: { createdAt: { gte: new Date(jetzt.getTime() - 30 * 864e5) } }, _sum: { amountCents: true }, _count: true }),
  ]);
  const href = (p: Record<string, string | undefined>) => `/gutscheine?${new URLSearchParams(Object.entries({ ...params, ...p }).filter((e): e is [string, string] => !!e[1]))}`;
  const params = { q: sp.q, zustand, issuer: sp.issuer };
  return (
    <>
      <PageHeader title="Gutscheine" krumen={[{ label: 'Verkauf' }, { label: 'Gutscheine' }]} sub="Wertgutscheine, Gutscheine aus Stornos und importierte Partner-Codes.">
        <Link href="/gutscheine/neu" className="btn-primary"><Icon name="plus" className="h-4 w-4" />Gutscheine anlegen</Link>
      </PageHeader>
      <Kennzahlen items={[
        { label: 'Offenes Guthaben (eigene)', wert: formatEur(summe._sum.remainingCents ?? 0), ton: 'gold', icon: 'gutschein', hinweis: 'Gutscheinverbindlichkeit' },
        { label: 'Einlösbare Gutscheine', wert: aktivAnzahl.toLocaleString('de-AT') },
        { label: 'Eingelöst (30 Tage)', wert: formatEur(eingeloest._sum.amountCents ?? 0), hinweis: `${eingeloest._count} Einlösungen` },
      ]} />
      <div className="card mb-4 !overflow-visible">
        <form method="get" role="search" aria-label="Gutscheine suchen" className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_14rem_auto] sm:items-end">
          <input type="hidden" name="zustand" value={zustand} />
          <div><label htmlFor="q" className="label">Code oder Notiz</label>
            <div className="relative"><Icon name="suche" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" /><input id="q" name="q" type="search" defaultValue={sp.q} className="input !pl-9" placeholder="z. B. LOC-AB12 oder Gewinnspiel" /></div></div>
          <div><label htmlFor="issuer" className="label">Herausgeber</label><select id="issuer" name="issuer" defaultValue={sp.issuer ?? ''} className="input"><option value="">Alle</option>{issuer.map((i) => <option key={i.issuer} value={i.issuer}>{ISSUER_NAME[i.issuer] ?? i.issuer} ({i._count._all})</option>)}</select></div>
          <button className="btn-primary">Suchen</button>
        </form>
        <div className="border-t border-line-soft px-4 py-3">
          <FilterChips label="Zustand" chips={ZUSTAND.map(([k, l]) => ({ label: l, href: href({ zustand: k, seite: undefined }), aktiv: zustand === k }))} />
        </div>
      </div>
      <section className="card tabelle-frei" aria-label="Ergebnisse">
        {liste.length ? (
          <table className="table rtab">
            <caption className="sr-only">Gutscheine</caption>
            <thead><tr><th scope="col">Code</th><th scope="col">Herausgeber</th><th scope="col">Restwert</th><th scope="col">Gültig bis</th><th scope="col">Status</th><th scope="col" className="text-right">Einlösungen</th><th scope="col">Notiz</th></tr></thead>
            <tbody>{liste.map((v) => {
              const abgelaufen = !!v.validUntil && v.validUntil < jetzt;
              const pct = v.valueCents ? Math.round((v.remainingCents / v.valueCents) * 100) : 0;
              return (
                <tr key={v.id}>
                  <td className="rtab-kopf"><Link href={`/gutscheine/${v.id}`} className="font-mono text-[13px] font-semibold underline-offset-4 hover:underline">{v.code}</Link></td>
                  <td data-label="Herausgeber">{ISSUER_NAME[v.issuer] ?? v.issuer}{v.kind === 'partner' && <span className="block text-xs text-muted">Partner</span>}</td>
                  <td data-label="Restwert" className="min-w-40">
                    <div><span className="num font-semibold">{formatEur(v.remainingCents)}</span><span className="num text-xs text-muted"> von {formatEur(v.valueCents)}</span></div>
                    <div aria-hidden="true" className="mt-1 h-1 w-28 overflow-hidden rounded-full bg-line max-md:hidden"><div className="h-full rounded-full bg-gold" style={{ width: `${pct}%` }} /></div>
                  </td>
                  <td data-label="Gültig bis" className="whitespace-nowrap">{v.validUntil ? fmtDatum(v.validUntil) : 'unbefristet'}</td>
                  <td data-label="Status">{!v.active ? <StatusPill status="storniert" label="Deaktiviert" /> : abgelaufen ? <StatusPill status="fehler" label="Abgelaufen" /> : v.remainingCents === 0 ? <StatusPill status="erstattet" label="Aufgebraucht" /> : <StatusPill status="bezahlt" label="Einlösbar" />}</td>
                  <td data-label="Einlösungen" className="num text-right">{v._count.redemptions}</td><td data-label="Notiz" className={`max-w-60 truncate text-muted ${v.note ? '' : 'rtab-leer'}`} title={v.note}>{v.note}</td>
                </tr>
              );
            })}</tbody>
          </table>
        ) : <Empty icon="gutschein" titel="Keine Gutscheine gefunden" aktion={<Link href="/gutscheine?zustand=alle" className="btn-secondary btn-sm">Alle Gutscheine zeigen</Link>}>Für diesen Zustand oder Suchbegriff gibt es keine Gutscheine.</Empty>}
        <Seiten seite={seite} seiten={Math.ceil(anzahl / PRO_SEITE)} basis="/gutscheine" params={params} gesamt={anzahl} pro={PRO_SEITE} />
      </section>
    </>
  );
}
