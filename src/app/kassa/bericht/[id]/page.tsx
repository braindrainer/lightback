import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { db, getSettings } from '@/lib/db';
import { fmtDatumZeit } from '@/lib/dates';
import { kassenbericht } from '@/lib/kassa';
import { formatEur } from '@/lib/money';
import { DruckSteuerung } from '../../Bon';
import { BON_CSS } from '../../bon-css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Kassabericht' };

/** X-Bericht (Schicht offen, Zwischenstand) bzw. Z-Bericht (Schicht abgeschlossen) */
export default async function Bericht({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ druck?: string }> }) {
  await requireRole('kassa');
  const { id } = await params;
  const { druck } = await searchParams;
  if (!(await db.cashSession.findUnique({ where: { id }, select: { id: true } }))) notFound();
  const [b, s] = await Promise.all([kassenbericht(id), getSettings()]);
  const z = !!b.session.closedAt;
  const diff = b.session.countedCents != null ? b.session.countedCents - (b.session.expectedCents ?? b.erwartet) : null;
  const Z = ({ l, w, fett }: { l: string; w: string; fett?: boolean }) => <div className={`z ${fett ? 'gross' : ''}`}><span>{l}</span><span>{w}</span></div>;
  return (
    <div className="bg-paper py-4 print:bg-white print:py-0">
      <style dangerouslySetInnerHTML={{ __html: BON_CSS }} />
      <DruckSteuerung auto={druck === '1'} zurueck="/kassa/schicht" />
      <article className="bon mx-auto shadow-md" aria-label={z ? 'Z-Bericht' : 'X-Bericht'}>
        <div className="mitte"><h1>{s.companyName}</h1><div>UID {s.uid}</div></div>
        <hr />
        <div className="marke">{z ? 'Z-BERICHT (Schichtabschluss)' : 'X-BERICHT (Zwischenstand)'}</div>
        <Z l="Kasse" w={`${b.register.name} (${b.register.kassenId})`} />
        <Z l="Geöffnet" w={fmtDatumZeit(b.session.openedAt)} />
        <Z l="von" w={b.session.openedByName} />
        {z && <Z l="Geschlossen" w={fmtDatumZeit(b.session.closedAt!)} />}
        {z && b.session.closedByName && <Z l="von" w={b.session.closedByName} />}
        <Z l="Erstellt" w={fmtDatumZeit(new Date())} />
        <Z l="Belege Nr." w={b.von ? `${b.von} – ${b.bis}` : '–'} />
        <hr />
        <Z l="Verkäufe" w={String(b.anzahl)} />
        <Z l="Umsatz brutto" w={formatEur(b.umsatz)} fett />
        <Z l="davon bar" w={formatEur(b.jeZahlart.bar)} />
        <Z l="davon Karte" w={formatEur(b.jeZahlart.karte)} />
        <Z l="davon Tickets" w={formatEur(b.tickets)} />
        <Z l="davon Gutscheine" w={formatEur(b.gutscheine)} />
        <Z l={`Stornos (${b.storno.anzahl})`} w={formatEur(b.storno.summe)} />
        <hr />
        <div className="z"><span>Satz</span><span>Netto · USt · Brutto</span></div>
        {b.jeSatz.map((t) => <Z key={t.satz} l={`${t.satz} %`} w={`${formatEur(t.netto)} · ${formatEur(t.ust)} · ${formatEur(t.brutto)}`} />)}
        <hr />
        <Z l="Wechselgeld" w={formatEur(b.session.floatCents)} />
        <Z l="+ Bar netto" w={formatEur(b.jeZahlart.bar)} />
        <Z l="Soll-Bestand" w={formatEur(b.session.expectedCents ?? b.erwartet)} fett />
        {b.session.countedCents != null && <Z l="Gezählt" w={formatEur(b.session.countedCents)} />}
        {diff != null && <Z l="Differenz" w={formatEur(diff, { sign: true })} fett />}
        {b.session.note && <div>Notiz: {b.session.note}</div>}
        <hr />
        <Z l={`Trainingsbelege (${b.training.anzahl})`} w={formatEur(b.training.summe)} />
        {b.ausgefallen > 0 && <div className="marke">{b.ausgefallen} Beleg(e) ohne Signatur – Sicherheitseinrichtung ausgefallen</div>}
        {!z && <div className="mitte">Zwischenstand – Schicht noch offen</div>}
      </article>
    </div>
  );
}
