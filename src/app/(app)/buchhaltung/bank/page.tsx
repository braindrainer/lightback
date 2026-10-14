import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { db } from '@/lib/db';
import { vorschlaege } from '@/lib/finanzen/bank';
import { ANBIETER } from '@/lib/finanzen/buchhaltung';
import { STEUERCODE_TEXT } from '@/lib/finanzen/texte';
import { fmtBuchDatum } from '@/lib/finanzen/zeitraum';
import { Formular, Senden } from '@/components/finanzen/Formular';
import { Hochladen } from '@/components/finanzen/Hochladen';
import { Empty, Money } from '@/components/ui';
import { bankZuordnenAktion } from '../actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Bank – Buchhaltung' };

const STATUS: Record<string, [string, string]> = { neu: ['Neu', 'bg-amber-50 text-amber-800'], gebucht: ['Gebucht', 'bg-emerald-50 text-emerald-800'], ignoriert: ['Ignoriert', 'bg-gray-100 text-gray-700'] };

export default async function Bank({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireRole('buchhaltung');
  const sp = await searchParams;
  const status = sp.status === 'alle' ? '' : STATUS[sp.status ?? ''] ? sp.status! : 'neu';
  const [tx, zahl, rechnungen, belege, konten] = await Promise.all([
    db.bankTransaction.findMany({ where: status ? { status } : {}, orderBy: [{ bookingDate: 'desc' }, { createdAt: 'desc' }], take: 50 }),
    db.bankTransaction.groupBy({ by: ['status'], _count: true }),
    db.invoice.findMany({ where: { kind: 'rechnung', status: 'offen', orderId: null }, orderBy: { issueDate: 'asc' }, select: { id: true, number: true, grossCents: true, recipient: true } }),
    db.expense.findMany({ where: { status: 'offen' }, orderBy: { docDate: 'asc' }, select: { id: true, docNumber: true, grossCents: true, supplier: true } }),
    db.account.findMany({ where: { active: true, number: { not: '2800' } }, orderBy: { number: 'asc' }, select: { number: true, name: true } }),
  ]);
  const offen = { rechnungen: rechnungen.map((r) => ({ id: r.id, number: r.number, grossCents: r.grossCents, name: (r.recipient as { company?: string; name?: string }).company || (r.recipient as { name?: string }).name || '' })), belege };
  const anzahl = new Map(zahl.map((z) => [z.status, z._count]));
  const buchungen = new Map((await db.journalEntry.findMany({ where: { id: { in: tx.map((t) => t.entryId).filter((x): x is string => !!x) } }, select: { id: true, number: true } })).map((e) => [e.id, e.number]));
  return (
    <>
      <section className="card relative mb-6 p-5" aria-labelledby="h-imp">
        <h2 id="h-imp" className="h2 mb-1">Kontoauszug importieren</h2>
        <p className="mb-3 text-sm text-muted">CSV aus George, ELBA, N26, Bank Austria oder CAMT.053 (XML). Bereits importierte Umsätze werden erkannt und nicht doppelt angelegt.</p>
        <Hochladen url="/buchhaltung/bank/import" knopf="Importieren" className="flex flex-wrap items-end gap-3">
          <div><label className="label" htmlFor="bk-datei">Datei</label><input id="bk-datei" name="datei" type="file" required accept=".csv,.txt,.xml,text/csv,application/xml,text/xml" className="input" /></div>
        </Hochladen>
      </section>
      <nav aria-label="Status der Bankumsätze" className="mb-3 flex flex-wrap gap-2 text-sm">
        {[['neu', 'Neu'], ['gebucht', 'Gebucht'], ['ignoriert', 'Ignoriert'], ['alle', 'Alle']].map(([k, l]) => (
          <Link key={k} href={`/buchhaltung/bank?status=${k}`} aria-current={(status || 'alle') === k ? 'page' : undefined} className={`rounded-full border px-3 py-1.5 ${(status || 'alle') === k ? 'border-ink bg-ink text-white' : 'border-line bg-white'}`}>{l}{k !== 'alle' ? ` (${anzahl.get(k) ?? 0})` : ''}</Link>
        ))}
      </nav>
      <datalist id="bank-konten">{konten.map((k) => <option key={k.number} value={k.number}>{k.number} {k.name}</option>)}</datalist>
      <section className="card relative" aria-labelledby="h-tx">
        <h2 id="h-tx" className="h2 px-5 pt-4">Bankumsätze</h2>
        {tx.length ? (
          <ul className="mt-3">
            {tx.map((t) => {
              const v = t.status === 'neu' ? vorschlaege(t, offen) : [];
              const [sl, sc] = STATUS[t.status] ?? [t.status, ''];
              return (
                <li key={t.id} className="border-t border-line px-5 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{fmtBuchDatum(t.bookingDate)} · {t.counterparty || 'ohne Name'} <span className={`pill ml-1 ${sc}`}>{sl}</span></p>
                      <p className="break-words text-sm text-muted">{t.reference || '–'}{t.iban && <> · {t.iban}</>}</p>
                      {t.entryId && <p className="text-xs"><Link href={`/buchhaltung?nr=${buchungen.get(t.entryId)}`} className="underline underline-offset-4">Buchung Nr. {buchungen.get(t.entryId)}</Link></p>}
                    </div>
                    <p className="text-lg font-semibold"><Money cents={t.amountCents} colored /></p>
                  </div>
                  {t.status === 'neu' && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-sm font-medium underline underline-offset-4">Zuordnen{v.length ? ` (${v.length} ${v.length === 1 ? 'Vorschlag' : 'Vorschläge'})` : ''}<span className="sr-only">: {t.counterparty} <Money cents={t.amountCents} /></span></summary>
                      <div className="mt-3 grid gap-4 lg:grid-cols-2">
                        {v.length > 0 && (
                          <div className="rounded-lg border border-line p-3 lg:col-span-2">
                            <p className="mb-2 text-sm font-semibold">Vorschläge</p>
                            <div className="flex flex-wrap gap-2">
                              {v.filter((x) => x.art !== 'auszahlung').map((x) => (
                                <Formular key={x.id} action={bankZuordnenAktion.bind(null, t.id)}>
                                  <input type="hidden" name="art" value={x.art} /><input type="hidden" name="ziel" value={x.id} />
                                  <Senden className={x.stark ? 'btn-gold btn-sm' : 'btn-secondary btn-sm'}>{x.label}</Senden>
                                </Formular>
                              ))}
                              {v.some((x) => x.art === 'auszahlung') && <p className="text-sm">Sieht aus wie eine Auszahlung von {v.find((x) => x.art === 'auszahlung')!.id} – siehe unten.</p>}
                            </div>
                          </div>
                        )}
                        {t.amountCents > 0 && offen.rechnungen.length > 0 && (
                          <Formular action={bankZuordnenAktion.bind(null, t.id)} className="flex flex-wrap items-end gap-2 rounded-lg border border-line p-3">
                            <input type="hidden" name="art" value="rechnung" />
                            <div className="min-w-48 flex-1"><label className="label" htmlFor={`re-${t.id}`}>Offene Rechnung</label><select id={`re-${t.id}`} name="ziel" className="input">{offen.rechnungen.map((r) => <option key={r.id} value={r.id}>{r.number} · {r.name} · {(r.grossCents / 100).toFixed(2).replace('.', ',')} €</option>)}</select></div>
                            <Senden className="btn-secondary">Zahlungseingang buchen</Senden>
                          </Formular>
                        )}
                        {t.amountCents < 0 && belege.length > 0 && (
                          <Formular action={bankZuordnenAktion.bind(null, t.id)} className="flex flex-wrap items-end gap-2 rounded-lg border border-line p-3">
                            <input type="hidden" name="art" value="beleg" />
                            <div className="min-w-48 flex-1"><label className="label" htmlFor={`be-${t.id}`}>Offener Beleg</label><select id={`be-${t.id}`} name="ziel" className="input">{belege.map((b) => <option key={b.id} value={b.id}>{b.supplier} {b.docNumber} · {(b.grossCents / 100).toFixed(2).replace('.', ',')} €</option>)}</select></div>
                            <Senden className="btn-secondary">Zahlung buchen</Senden>
                          </Formular>
                        )}
                        {t.amountCents > 0 && (
                          <Formular action={bankZuordnenAktion.bind(null, t.id)} className="flex flex-wrap items-end gap-2 rounded-lg border border-line p-3">
                            <input type="hidden" name="art" value="auszahlung" />
                            <div><label className="label" htmlFor={`an-${t.id}`}>Auszahlung von</label><select id={`an-${t.id}`} name="provider" defaultValue={v.find((x) => x.art === 'auszahlung')?.id ?? ''} className="input" required><option value="">Anbieter wählen</option>{Object.entries(ANBIETER).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
                            <div><label className="label" htmlFor={`ag-${t.id}`}>Gebühren €</label><input id={`ag-${t.id}`} name="gebuehr" inputMode="decimal" className="input num w-24" /></div>
                            <div><label className="label" htmlFor={`av-${t.id}`}>Zahlungen von</label><input id={`av-${t.id}`} name="von" type="date" className="input" /></div>
                            <div><label className="label" htmlFor={`ab-${t.id}`}>bis</label><input id={`ab-${t.id}`} name="bis" type="date" className="input" /></div>
                            <Senden className="btn-secondary">Auszahlung buchen</Senden>
                          </Formular>
                        )}
                        <Formular action={bankZuordnenAktion.bind(null, t.id)} className="flex flex-wrap items-end gap-2 rounded-lg border border-line p-3">
                          <input type="hidden" name="art" value="konto" />
                          <div><label className="label" htmlFor={`gk-${t.id}`}>Gegenkonto</label><input id={`gk-${t.id}`} name="konto" list="bank-konten" required autoComplete="off" className="input num w-32" /></div>
                          <div><label className="label" htmlFor={`gs-${t.id}`}>Steuercode</label><select id={`gs-${t.id}`} name="vatCode" className="input"><option value="">ohne</option>{Object.entries(STEUERCODE_TEXT).map(([c, l]) => <option key={c} value={c}>{l}</option>)}</select></div>
                          <div className="min-w-40 flex-1"><label className="label" htmlFor={`gt-${t.id}`}>Buchungstext</label><input id={`gt-${t.id}`} name="text" defaultValue={`${t.counterparty} ${t.reference}`.trim().slice(0, 120)} className="input" /></div>
                          <Senden className="btn-secondary">Buchen</Senden>
                        </Formular>
                        <Formular action={bankZuordnenAktion.bind(null, t.id)} className="flex items-end">
                          <input type="hidden" name="art" value="ignorieren" />
                          <Senden className="btn-secondary">Ignorieren (z. B. Umbuchung, schon erfasst)</Senden>
                        </Formular>
                      </div>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        ) : <Empty>Keine Bankumsätze in dieser Ansicht.</Empty>}
      </section>
    </>
  );
}
