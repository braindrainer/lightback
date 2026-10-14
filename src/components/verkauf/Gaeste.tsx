'use client';
// Gästeliste: Gast anlegen (beste Plätze oder im Saalplan gewählt), Sammelimport, Kontingent, Freikarten zurückziehen,
// dazu die Dialoge „Nachricht an alle Gäste“ und „Vorstellung abgebrochen“ der Vorstellungsseite.
import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';
import { sitzName } from '@/lib/saal';
import type { Status } from '@/lib/seats';
import { DialogKnopf } from './Dialog';
import type { Ergebnis } from './ergebnis';
import { Absenden, AktionForm, Meldung } from './form';
import Saalplan from './Saalplan';

type Aktion = (p: Ergebnis, fd: FormData) => Promise<Ergebnis>;
export type GastDaten = {
  name: string; email?: string; phone?: string; company?: string; anzahl: number; kat: 'I' | 'II' | 'R'; seats?: string[];
  grund: string; notiz: string; mail: boolean; hinterlegt: boolean; begleitung: boolean;
};

export function GastFormular({ gruende, status, max, action }: { gruende: readonly string[]; status: Record<string, Status>; max: number; action: (d: GastDaten) => Promise<Ergebnis> }) {
  const id = useId();
  const router = useRouter();
  const [plan, setPlan] = useState(false);
  const [seats, setSeats] = useState<string[]>([]);
  const [mail, setMail] = useState(true);
  const [hinterlegt, setHinterlegt] = useState(false);
  const [kat, setKat] = useState<'I' | 'II' | 'R'>('I');
  const [e, setE] = useState<Ergebnis>();
  const [laeuft, start] = useTransition();

  function senden(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const form = ev.currentTarget;
    const d: GastDaten = {
      name: String(f.get('name') ?? ''), email: String(f.get('email') ?? ''), phone: String(f.get('phone') ?? ''), company: String(f.get('company') ?? ''),
      anzahl: plan ? Math.max(1, seats.length) : Number(f.get('anzahl') ?? 1), kat, seats: plan ? seats : undefined,
      grund: String(f.get('grund') ?? ''), notiz: String(f.get('notiz') ?? ''), mail, hinterlegt, begleitung: f.get('begleitung') === 'on',
    };
    if (plan && !seats.length) { setE({ fehler: 'Bitte im Saalplan mindestens einen Platz wählen.' }); return; }
    start(async () => {
      const r = await action(d);
      setE(r);
      if (!r.fehler) { form.reset(); setSeats([]); router.refresh(); }
    });
  }

  return (
    <form onSubmit={senden} className="grid gap-4" aria-describedby={`${id}-h`}>
      <p id={`${id}-h`} className="text-sm text-muted">Freikarten kosten 0 €: keine Rechnung, keine Buchung. Pflichtfelder: Name, Anzahl oder Plätze, Grund, Zustellung.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label htmlFor={`${id}-name`} className="label">Name (Vor- und Nachname)</label><input id={`${id}-name`} name="name" required minLength={2} maxLength={120} autoComplete="off" className="input" /></div>
        <div><label htmlFor={`${id}-company`} className="label">Firma / Medium (optional)</label><input id={`${id}-company`} name="company" maxLength={200} className="input" /></div>
        <div><label htmlFor={`${id}-email`} className="label">E-Mail{mail ? '' : ' (optional)'}</label><input id={`${id}-email`} name="email" type="email" required={mail} autoComplete="off" className="input" /></div>
        <div><label htmlFor={`${id}-phone`} className="label">Telefon (optional)</label><input id={`${id}-phone`} name="phone" type="tel" maxLength={40} className="input" /></div>
      </div>
      <fieldset className="grid gap-3 rounded-lg bg-paper p-3">
        <legend className="sr-only">Plätze</legend>
        <div className="flex flex-wrap items-end gap-3">
          {!plan && <div><label htmlFor={`${id}-n`} className="label">Anzahl Karten</label><input id={`${id}-n`} name="anzahl" type="number" min={1} max={max} defaultValue={2} required className="input w-28" /></div>}
          {!plan && (
            <div><label htmlFor={`${id}-kat`} className="label">Kategorie</label>
              <select id={`${id}-kat`} value={kat} onChange={(x) => setKat(x.target.value as 'I' | 'II' | 'R')} className="input">
                <option value="I">Kategorie I</option><option value="II">Kategorie II</option><option value="R">Rollstuhlplatz (inkl. Begleitsitz)</option>
              </select></div>
          )}
          <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={plan} onChange={(x) => { setPlan(x.target.checked); setSeats([]); }} className="size-5 accent-accent" />Plätze im Saalplan wählen</label>
          {!plan && kat !== 'R' && <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name="begleitung" className="size-5 accent-accent" />Begleitung erlaubt (+1 Karte)</label>}
        </div>
        {plan && (
          <>
            <p className="text-sm" aria-live="polite">{seats.length ? `${seats.length} gewählt: ${seats.map(sitzName).join(' · ')}` : 'Freie Plätze im Plan antippen.'}</p>
            <Saalplan status={status} modus="auswahl" auswahl={seats} onAuswahl={(ids) => setSeats(ids.slice(0, max + 1))} titel="Saalplan, Plätze für den Gast wählen" />
          </>
        )}
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label htmlFor={`${id}-grund`} className="label">Grund</label>
          <select id={`${id}-grund`} name="grund" required defaultValue="" className="input"><option value="" disabled>Bitte wählen …</option>{gruende.map((g) => <option key={g}>{g}</option>)}</select></div>
        <div><label htmlFor={`${id}-notiz`} className="label">Notiz (intern, optional)</label><input id={`${id}-notiz`} name="notiz" maxLength={500} className="input" /></div>
      </div>
      <fieldset>
        <legend className="label">Zustellung (mindestens eine)</legend>
        <div className="flex flex-wrap gap-x-5">
          <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={mail} onChange={(x) => setMail(x.target.checked)} className="size-5 accent-accent" />Per E-Mail senden (Ticket mit QR-Code)</label>
          <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={hinterlegt} onChange={(x) => setHinterlegt(x.target.checked)} className="size-5 accent-accent" />An der Kassa hinterlegt</label>
        </div>
      </fieldset>
      <div><button type="submit" className="btn-primary" disabled={laeuft || (!mail && !hinterlegt)} aria-disabled={laeuft || (!mail && !hinterlegt)}>{laeuft ? 'Bitte warten …' : 'Gast anlegen'}</button></div>
      <Meldung e={e} />
    </form>
  );
}

export function ImportFormular({ action }: { action: Aktion }) {
  const id = useId();
  return (
    <AktionForm action={action} zuruecksetzen>
      <div>
        <label htmlFor={`${id}-t`} className="label">Liste einfügen – eine Zeile je Gast: Name;E-Mail;Anzahl;Grund</label>
        <textarea id={`${id}-t`} name="text" rows={6} required className="input font-mono" placeholder={'Erika Muster;erika@example.org;2;Presse\nMax Beispiel;;1;Sponsor'} aria-describedby={`${id}-h`} />
        <p id={`${id}-h`} className="mt-1 text-xs text-muted">Aus Excel kopierte Spalten (Tabulator) gehen auch. Unbekannte Gründe werden „Sonstiges“, der Text kommt in die Notiz. Bis 200 Zeilen.</p>
      </div>
      <div className="flex flex-wrap items-end gap-4">
        <div><label htmlFor={`${id}-k`} className="label">Kategorie für alle</label><select id={`${id}-k`} name="kat" className="input"><option value="I">Kategorie I</option><option value="II">Kategorie II</option></select></div>
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name="mail" defaultChecked className="size-5 accent-accent" />E-Mail senden, wenn Adresse vorhanden</label>
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name="hinterlegt" className="size-5 accent-accent" />Alle an der Kassa hinterlegen</label>
      </div>
      <p className="text-xs text-muted">Zeilen ohne E-Mail werden immer an der Kassa hinterlegt.</p>
      <div><Absenden>Liste importieren</Absenden></div>
    </AktionForm>
  );
}

export function KontingentFormular({ action, limit }: { action: Aktion; limit: number | null }) {
  const id = useId();
  return (
    <AktionForm action={action} className="flex flex-wrap items-end gap-3">
      <div><label htmlFor={`${id}-l`} className="label">Freikarten-Kontingent</label><input id={`${id}-l`} name="limit" type="number" min={0} max={662} defaultValue={limit ?? ''} placeholder="ohne Grenze" className="input w-36" aria-describedby={`${id}-h`} /></div>
      <Absenden className="btn-secondary">Speichern</Absenden>
      <p id={`${id}-h`} className="basis-full text-xs text-muted">Leer = ohne Grenze. Beim Überschreiten erscheint ein Hinweis, die Karten werden trotzdem angelegt.</p>
    </AktionForm>
  );
}

export function GastStornoDialog({ action, name }: { action: Aktion; name: string }) {
  const id = useId();
  return (
    <DialogKnopf titel={`Freikarten zurückziehen: ${name}`} knopf={<>Zurückziehen<span className="sr-only"> ({name})</span></>} knopfKlasse="btn-secondary btn-sm">
      <AktionForm action={action}>
        <p className="text-sm">Die Karten werden storniert, die Plätze sind sofort wieder frei. Der Gast bekommt keine Mail.</p>
        <div><label htmlFor={`${id}-g`} className="label">Grund</label><input id={`${id}-g`} name="grund" required minLength={3} maxLength={200} className="input" /></div>
        <div><Absenden className="btn-danger">Freikarten zurückziehen</Absenden></div>
      </AktionForm>
    </DialogKnopf>
  );
}

export function NachrichtDialog({ action, empfaenger, titel }: { action: Aktion; empfaenger: number; titel: string }) {
  const id = useId();
  return (
    <DialogKnopf titel={`Nachricht an alle Gäste: ${titel}`} knopf="Nachricht an alle Gäste" breit>
      <AktionForm action={action}>
        <p className="rounded-lg bg-paper px-3 py-2 text-sm">Geht an <strong>{empfaenger}</strong> {empfaenger === 1 ? 'Adresse' : 'Adressen'} (bezahlte Buchungen mit E-Mail, jede Adresse einmal). Vorlage „Nachricht an alle Gäste“, Versand im E-Mail-Protokoll.</p>
        <div><label htmlFor={`${id}-b`} className="label">Betreff</label><input id={`${id}-b`} name="betreff" required minLength={3} maxLength={150} className="input" placeholder="z. B. Beginn verschiebt sich um 15 Minuten" /></div>
        <div><label htmlFor={`${id}-t`} className="label">Text</label><textarea id={`${id}-t`} name="text" rows={6} required minLength={10} maxLength={5000} className="input" placeholder="z. B. Hinweis Garderobe, warme Kleidung, geänderter Eingang" aria-describedby={`${id}-h`} /><p id={`${id}-h`} className="mt-1 text-xs text-muted">Anrede, Termin und Adresse ergänzt die Vorlage. Leerzeile = neuer Absatz.</p></div>
        <label className="flex min-h-11 items-center gap-2 text-sm font-semibold"><input type="checkbox" name="bestaetigt" value="ja" required className="size-5 accent-accent" />Ja, an {empfaenger} {empfaenger === 1 ? 'Adresse' : 'Adressen'} senden</label>
        <div><Absenden disabled={!empfaenger}>Jetzt senden</Absenden></div>
      </AktionForm>
    </DialogKnopf>
  );
}

export function AbbruchDialog({ action, titel, bestellungen, versteckt }: { action: Aktion; titel: string; bestellungen: number; versteckt?: boolean }) {
  const id = useId();
  return (
    <DialogKnopf titel={`Vorstellung abgebrochen: ${titel}`} knopf="Vorstellung abgebrochen …" knopfKlasse="btn-danger" versteckt={versteckt}>
      <AktionForm action={action}>
        <p className="text-sm">Für alle gültigen und eingelassenen Tickets ({bestellungen} Bestellungen) wird ein Kulanz-Gutschein ausgestellt und per E-Mail verschickt. Die Tickets werden storniert, der Verkauf wird pausiert. Das lässt sich nicht rückgängig machen.</p>
        <div><label htmlFor={`${id}-g`} className="label">Grund (steht in der E-Mail)</label><textarea id={`${id}-g`} name="grund" rows={3} required minLength={3} maxLength={500} className="input" placeholder="z. B. Wegen einer technischen Störung." /></div>
        <div><label htmlFor={`${id}-p`} className="label">Gutschein in % des Ticketpreises</label><input id={`${id}-p`} name="prozent" type="number" min={0} max={100} defaultValue={100} required className="input w-28" aria-describedby={`${id}-h`} /><p id={`${id}-h`} className="mt-1 text-xs text-muted">100 % = voller Wert. Ein Rest bleibt als Erlös (Leistung teilweise erbracht).</p></div>
        <label className="flex min-h-11 items-center gap-2 text-sm font-semibold"><input type="checkbox" name="bestaetigt" value="ja" required className="size-5 accent-accent" />Ja, die Vorstellung wurde abgebrochen</label>
        <div><Absenden className="btn-danger">Abbruch bestätigen</Absenden></div>
      </AktionForm>
    </DialogKnopf>
  );
}
