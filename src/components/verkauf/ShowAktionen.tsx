'use client';
// Vorstellung bearbeiten und absagen
import type { Preise } from '@/lib/saal';
import { DialogKnopf } from './Dialog';
import type { Ergebnis } from './ergebnis';
import { Absenden, AktionForm } from './form';
import PreisFelder from './PreisFelder';

type Aktion = (p: Ergebnis, fd: FormData) => Promise<Ergebnis>;

export function BearbeitenFormular({ action, werte }: { action: Aktion; werte: { datum: string; zeit: string; status: string; notes: string; titel: string; preise: Preise } }) {
  return (
    <AktionForm action={action}>
      <div className="grid gap-3 sm:grid-cols-4">
        <div><label htmlFor="b-datum" className="label">Datum</label><input id="b-datum" name="datum" type="date" defaultValue={werte.datum} required className="input" /></div>
        <div><label htmlFor="b-zeit" className="label">Beginn</label><input id="b-zeit" name="zeit" type="time" defaultValue={werte.zeit} required className="input" /></div>
        <div><label htmlFor="b-status" className="label">Status</label>
          <select id="b-status" name="status" defaultValue={werte.status} className="input"><option value="verkauf">Im Verkauf</option><option value="pausiert">Verkauf pausiert</option><option value="geplant">Geplant</option></select></div>
        <div><label htmlFor="b-titel" className="label">Titel</label><input id="b-titel" name="titel" defaultValue={werte.titel} required className="input" /></div>
      </div>
      <PreisFelder preise={werte.preise} prefix="b-" />
      <div><label htmlFor="b-notes" className="label">Notiz (intern)</label><textarea id="b-notes" name="notes" defaultValue={werte.notes} rows={2} className="input" /></div>
      <p className="text-xs text-muted">Neue Preise gelten für künftige Buchungen; bereits verkaufte Tickets behalten ihren Preis.</p>
      <div><Absenden>Änderungen speichern</Absenden></div>
    </AktionForm>
  );
}

export function AbsageDialog({ action, titel, bestellungen, versteckt }: { action: Aktion; titel: string; bestellungen: number; versteckt?: boolean }) {
  return (
    <DialogKnopf titel={`Vorstellung absagen: ${titel}`} knopf="Vorstellung absagen" knopfKlasse="btn-danger" versteckt={versteckt}>
      <AktionForm action={action}>
        <p className="text-sm">Der Verkauf wird sofort beendet. {bestellungen} bezahlte Bestellungen werden storniert und die Kund:innen per E-Mail informiert. Das lässt sich nicht rückgängig machen.</p>
        <div><label htmlFor="a-grund" className="label">Grund (steht in der E-Mail)</label><textarea id="a-grund" name="grund" rows={3} required minLength={3} className="input" /></div>
        <fieldset>
          <legend className="label">Erstattung</legend>
          <label className="flex min-h-8 items-center gap-2 text-sm"><input type="radio" name="methode" value="zahlungsmittel" defaultChecked className="h-4 w-4 accent-accent" />Erstattung aufs Zahlungsmittel</label>
          <label className="flex min-h-8 items-center gap-2 text-sm"><input type="radio" name="methode" value="gutschein" className="h-4 w-4 accent-accent" />Gutschein über den vollen Betrag</label>
        </fieldset>
        <label className="flex min-h-8 items-center gap-2 text-sm font-semibold"><input type="checkbox" name="bestaetigt" value="ja" required className="h-4 w-4 accent-accent" />Ja, diese Vorstellung absagen</label>
        <div><Absenden className="btn-danger">Endgültig absagen</Absenden></div>
      </AktionForm>
    </DialogKnopf>
  );
}
