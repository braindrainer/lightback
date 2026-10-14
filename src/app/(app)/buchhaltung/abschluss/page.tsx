import { requireRole } from '@/lib/auth';
import { db, getSettings } from '@/lib/db';
import { fmtBuchDatum, heute, tagStr, zeitraum } from '@/lib/finanzen/zeitraum';
import { Formular, Senden } from '@/components/finanzen/Formular';
import { abrechnenAktion, festschreibenAktion } from '../actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Abschluss und Export – Buchhaltung' };

export default async function Abschluss({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const u = await requireRole('buchhaltung');
  const { von, bis } = zeitraum(await searchParams);
  const s = await getSettings();
  const [vergangen, erledigt] = await Promise.all([
    db.show.findMany({ where: { startsAt: { lte: new Date() }, status: { not: 'abgesagt' }, tickets: { some: { status: { not: 'storniert' }, order: { status: { in: ['bezahlt', 'teilstorniert'] } } } } }, select: { id: true } }),
    db.journalEntry.findMany({ where: { source: 'leistung' }, select: { sourceId: true } }),
  ]);
  const fertig = new Set(erledigt.map((e) => e.sourceId));
  const offen = vergangen.filter((x) => !fertig.has(x.id)).length;
  const admin = u.roles.includes('admin');
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <section className="card relative p-5" aria-labelledby="h-abr">
        <h2 id="h-abr" className="h2 mb-1">Vorstellungen abrechnen</h2>
        <p className="mb-3 text-sm text-muted">Bucht für vergangene Vorstellungen die erhaltenen Anzahlungen (3480) in die Ticketerlöse (4000) um – mit Datum der Vorstellung. Die Umsatzsteuer ist bereits mit der Zahlung erfasst. Mehrfaches Ausführen bucht nichts doppelt.</p>
        <p className="mb-3 text-sm"><strong>{offen}</strong> vergangene Vorstellungen mit verkauften Tickets sind noch nicht abgerechnet ({fertig.size} bereits abgerechnet).</p>
        <Formular action={abrechnenAktion}><Senden>Vorstellungen abrechnen</Senden></Formular>
      </section>
      <section className="card relative p-5" aria-labelledby="h-fest">
        <h2 id="h-fest" className="h2 mb-1">Festschreiben</h2>
        <p className="mb-3 text-sm text-muted">Nach Abgabe der UVA bzw. Übergabe an die Steuerberatung: Bis zu diesem Tag sind keine Buchungen mehr möglich (auch keine Automatikbuchungen; Korrekturen dann mit späterem Datum). Das Datum kann nur nach vorne verschoben werden.</p>
        <p className="mb-3 text-sm">Derzeit: {s.lockedUntil ? <strong>festgeschrieben bis {fmtBuchDatum(s.lockedUntil)}</strong> : 'nichts festgeschrieben'}.</p>
        {admin ? (
          <Formular action={festschreibenAktion} className="flex flex-wrap items-end gap-3" bestaetigen="Festschreiben kann nicht rückgängig gemacht werden. Fortfahren?">
            <div><label className="label" htmlFor="f-bis">Festschreiben bis einschließlich</label><input id="f-bis" type="date" name="bis" required min={s.lockedUntil ? tagStr(s.lockedUntil) : undefined} max={heute()} className="input" /></div>
            <Senden className="btn-danger">Festschreiben</Senden>
          </Formular>
        ) : <p className="text-sm text-muted">Festschreiben darf nur die Administration.</p>}
      </section>
      <section className="card relative p-5 xl:col-span-2" aria-labelledby="h-exp">
        <h2 id="h-exp" className="h2 mb-1">Export für die Steuerberatung</h2>
        <p className="mb-3 text-sm text-muted">CSV-Dateien für den gewählten Zeitraum. Der BMD-Export (NTCS Buchungsimport, Semikolon, ISO-8859-1) fasst Steuerzeilen mit der Grundzeile zusammen; Steuercodes und Buchungssymbole bitte mit der Steuerberatung per Testimport abstimmen. Belege liegen unter Buchhaltung → Belege.</p>
        <form className="flex flex-wrap items-end gap-3" aria-label="Exportzeitraum">
          <div><label className="label" htmlFor="x-von">Von</label><input id="x-von" type="date" name="von" defaultValue={von} required className="input" /></div>
          <div><label className="label" htmlFor="x-bis">Bis</label><input id="x-bis" type="date" name="bis" defaultValue={bis} required className="input" /></div>
          <button formAction="/buchhaltung/export/bmd" className="btn-primary">BMD-Buchungsimport (CSV)</button>
          <button formAction="/buchhaltung/export/journal" className="btn-secondary">Journal (alle Zeilen, CSV)</button>
          <button formAction="/buchhaltung/export/saldenliste" className="btn-secondary">Saldenliste (CSV)</button>
        </form>
      </section>
    </div>
  );
}
