import Link from 'next/link';
import type { Prisma } from '@prisma/client';
import { requireRole } from '@/lib/auth';
import { db } from '@/lib/db';
import { fmtDatum } from '@/lib/dates';
import { Empty, Money, PageHeader, StatusPill } from '@/components/ui';
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
  const [anzahl, liste, issuer, summe] = await Promise.all([
    db.voucher.count({ where }),
    db.voucher.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (seite - 1) * PRO_SEITE, take: PRO_SEITE, include: { _count: { select: { redemptions: true } } } }),
    db.voucher.groupBy({ by: ['issuer'], _count: { _all: true } }),
    db.voucher.aggregate({ where: { kind: 'wert', active: true, remainingCents: { gt: 0 } }, _sum: { remainingCents: true } }),
  ]);
  const params = { q: sp.q, zustand, issuer: sp.issuer };
  return (
    <>
      <PageHeader title="Gutscheine" sub={<>Offenes Guthaben eigener Gutscheine: <Money cents={summe._sum.remainingCents ?? 0} /></>}>
        <Link href="/gutscheine/neu" className="btn-primary">Gutscheine anlegen, verkaufen, importieren</Link>
      </PageHeader>
      <form method="get" role="search" aria-label="Gutscheine suchen" className="card mb-4 flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-56 flex-1"><label htmlFor="q" className="label">Code oder Notiz</label><input id="q" name="q" type="search" defaultValue={sp.q} className="input" /></div>
        <div><label htmlFor="zustand" className="label">Zustand</label><select id="zustand" name="zustand" defaultValue={zustand} className="input">{ZUSTAND.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        <div><label htmlFor="issuer" className="label">Herausgeber</label><select id="issuer" name="issuer" defaultValue={sp.issuer ?? ''} className="input"><option value="">Alle</option>{issuer.map((i) => <option key={i.issuer} value={i.issuer}>{ISSUER_NAME[i.issuer] ?? i.issuer} ({i._count._all})</option>)}</select></div>
        <button className="btn-primary">Suchen</button>
      </form>
      <section className="card" aria-label="Ergebnisse">
        {liste.length ? (
          <table className="table">
            <caption className="sr-only">Gutscheine</caption>
            <thead><tr><th scope="col">Code</th><th scope="col">Herausgeber</th><th scope="col" className="text-right">Wert</th><th scope="col" className="text-right">Rest</th><th scope="col">Gültig bis</th><th scope="col">Status</th><th scope="col" className="text-right">Einlösungen</th><th scope="col">Notiz</th></tr></thead>
            <tbody>{liste.map((v) => {
              const abgelaufen = !!v.validUntil && v.validUntil < jetzt;
              return (
                <tr key={v.id}>
                  <td><Link href={`/gutscheine/${v.id}`} className="font-mono font-medium underline-offset-4 hover:underline">{v.code}</Link></td>
                  <td>{ISSUER_NAME[v.issuer] ?? v.issuer}{v.kind === 'partner' && <span className="block text-xs text-muted">Partner</span>}</td>
                  <td className="text-right"><Money cents={v.valueCents} /></td><td className="text-right"><Money cents={v.remainingCents} /></td>
                  <td>{v.validUntil ? fmtDatum(v.validUntil) : 'unbegrenzt'}</td>
                  <td>{!v.active ? <StatusPill status="storniert" label="Deaktiviert" /> : abgelaufen ? <StatusPill status="fehler" label="Abgelaufen" /> : v.remainingCents === 0 ? <StatusPill status="erstattet" label="Aufgebraucht" /> : <StatusPill status="bezahlt" label="Einlösbar" />}</td>
                  <td className="num text-right">{v._count.redemptions}</td><td className="max-w-60 truncate" title={v.note}>{v.note}</td>
                </tr>
              );
            })}</tbody>
          </table>
        ) : <Empty>Keine Gutscheine gefunden.</Empty>}
        <Seiten seite={seite} seiten={Math.ceil(anzahl / PRO_SEITE)} basis="/gutscheine" params={params} />
      </section>
    </>
  );
}
