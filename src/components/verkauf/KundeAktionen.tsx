'use client';
import { DialogKnopf } from './Dialog';
import type { Ergebnis } from './ergebnis';
import { Absenden, AktionForm } from './form';

export function AnonymisierenDialog({ action, datensaetze, versteckt }: { action: (p: Ergebnis, fd: FormData) => Promise<Ergebnis>; datensaetze: number; versteckt?: boolean }) {
  return (
    <DialogKnopf titel="Daten anonymisieren (DSGVO)" knopf="Daten anonymisieren" knopfKlasse="btn-danger" versteckt={versteckt}>
      <AktionForm action={action}>
        <p className="text-sm">Name, E-Mail, Telefon, Firma und Adresse werden gelöscht{datensaetze > 1 ? ` – in allen ${datensaetze} Datensätzen mit dieser E-Mail-Adresse` : ''}. Bestellungen, Tickets und Rechnungen bleiben wegen der Aufbewahrungspflicht erhalten. Das lässt sich nicht rückgängig machen.</p>
        <label className="flex min-h-8 items-center gap-2 text-sm font-semibold"><input type="checkbox" name="bestaetigt" value="ja" required className="h-4 w-4 accent-accent" />Ja, Daten unwiderruflich anonymisieren</label>
        <div><Absenden className="btn-danger">Anonymisieren</Absenden></div>
      </AktionForm>
    </DialogKnopf>
  );
}
