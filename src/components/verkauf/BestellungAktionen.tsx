'use client';
// Aktionen auf einer Bestellung: Storno, Umbuchung, Zahlung erhalten, Kundendaten, Notiz
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/icons';
import { Drawer, toast } from '@/components/ui-client';
import { useState, useTransition } from 'react';
import type { UmbuchungEingabe } from '@/app/(app)/bestellungen/actions';
import { formatEur } from '@/lib/money';
import { DialogKnopf } from './Dialog';
import type { Ergebnis } from './ergebnis';
import { Absenden, AktionForm, Meldung } from './form';
import PlatzWahl, { type ShowOption, type Wahl } from './PlatzWahl';

type Aktion = (p: Ergebnis, fd: FormData) => Promise<Ergebnis>;
export type TicketZeile = { id: string; label: string; cents: number };

/** Ein Knopf, der eine Aktion ohne weitere Eingaben ausführt (optional mit Rückfrage) */
export function AktionKnopf({ action, children, className = 'btn-secondary', frage, leise }: { action: (p: Ergebnis) => Promise<Ergebnis>; children: React.ReactNode; className?: string; frage?: string; leise?: boolean }) {
  return (
    <AktionForm action={action} className="grid gap-2" leise={leise} onSubmit={(e) => { if (frage && !window.confirm(frage)) e.preventDefault(); }}>
      <Absenden className={className}>{children}</Absenden>
    </AktionForm>
  );
}

function FristFeld({ abgelaufen, darf }: { abgelaufen: boolean; darf: boolean }) {
  if (!abgelaufen) return null;
  return darf ? (
    <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
      <p>Die Vorstellung beginnt in weniger als 24 Stunden – laut AGB ist kein Storno mehr möglich.</p>
      <label className="mt-2 flex min-h-8 items-center gap-2 font-semibold"><input type="checkbox" name="frist" value="ja" className="h-4 w-4 accent-accent" />Frist übergehen (Ausnahme durch Leitung)</label>
    </div>
  ) : <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Die 24-Stunden-Frist ist vorbei. Nur die Leitung kann eine Ausnahme machen.</p>;
}

/** Formular für den Storno (ganze Bestellung oder einzelne Tickets); auch in der Bestellliste verwendet */
export function StornoFormular({ action, tickets, fristAbgelaufen, darfFrist, einzeln, onErfolg, prefix = 'st' }: { action: Aktion; tickets: TicketZeile[]; fristAbgelaufen: boolean; darfFrist: boolean; einzeln?: boolean; onErfolg?: (e: Ergebnis) => void; prefix?: string }) {
  const [umfang, setUmfang] = useState<'alle' | 'einzeln'>('alle');
  const [gutschein, setGutschein] = useState<string>();
  return (
    <AktionForm action={action} onErfolg={(e) => { setGutschein(e.daten?.gutschein as string | undefined); onErfolg?.(e); }}>
      {einzeln ? (
        <p className="text-sm"><input type="hidden" name="umfang" value="einzeln" /><input type="hidden" name="ticket" value={tickets[0]?.id} />Storniert wird nur {tickets[0]?.label} · {formatEur(tickets[0]?.cents ?? 0)}. Die übrigen Tickets der Bestellung bleiben gültig.</p>
      ) : <fieldset className="grid gap-2">
        <legend className="label">Umfang</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className={`flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 text-sm ${umfang === 'alle' ? 'border-nacht bg-paper' : 'border-line'}`}><input type="radio" name="umfang" value="alle" checked={umfang === 'alle'} onChange={() => setUmfang('alle')} className="mt-0.5 h-4 w-4 accent-accent" /><span><strong className="block font-semibold">Ganze Bestellung</strong><span className="text-muted">{tickets.length} Tickets · {formatEur(tickets.reduce((s, t) => s + t.cents, 0))}</span></span></label>
          <label className={`flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 text-sm ${umfang === 'einzeln' ? 'border-nacht bg-paper' : 'border-line'}`}><input type="radio" name="umfang" value="einzeln" checked={umfang === 'einzeln'} onChange={() => setUmfang('einzeln')} className="mt-0.5 h-4 w-4 accent-accent" /><span><strong className="block font-semibold">Einzelne Tickets</strong><span className="text-muted">Auswahl unten</span></span></label>
        </div>
      </fieldset>}
      {!einzeln && umfang === 'einzeln' && (
        <fieldset className="grid gap-0.5 rounded-lg border border-line p-3">
          <legend className="px-1 text-sm font-semibold">Tickets</legend>
          {tickets.map((t) => <label key={t.id} className="flex min-h-8 items-center gap-2 text-sm"><input type="checkbox" name="ticket" value={t.id} className="h-4 w-4 accent-accent" /><span className="flex-1">{t.label}</span><span className="num text-muted">{formatEur(t.cents)}</span></label>)}
        </fieldset>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label htmlFor={`${prefix}-methode`} className="label">Erstattung</label>
          <select id={`${prefix}-methode`} name="methode" className="input" defaultValue="zahlungsmittel"><option value="zahlungsmittel">Aufs Zahlungsmittel</option><option value="gutschein">Als Gutschein</option><option value="keine">Keine Erstattung</option></select></div>
        <div><label htmlFor={`${prefix}-grund`} className="label">Grund</label>
          <select id={`${prefix}-grund`} name="grund" className="input" defaultValue="kunde"><option value="kunde">Wunsch der Kund:in</option><option value="kulanz">Kulanz</option><option value="sonstiges">Sonstiges</option></select></div>
        <div><label htmlFor={`${prefix}-gebuehr`} className="label">Stornogebühr in € (optional)</label><input id={`${prefix}-gebuehr`} name="gebuehr" inputMode="decimal" placeholder="0,00" className="input num" /></div>
      </div>
      <div><label htmlFor={`${prefix}-notiz`} className="label">Notiz (intern)</label><textarea id={`${prefix}-notiz`} name="notiz" rows={2} className="input" /></div>
      <FristFeld abgelaufen={fristAbgelaufen} darf={darfFrist} />
      <p className="text-xs text-muted">Bar oder per Rechnung bezahlte Beträge bitte selbst auszahlen bzw. überweisen. Die Kund:in erhält eine Storno-E-Mail.</p>
      <div><Absenden className="btn bg-neg text-white hover:bg-[#8f1e18]">Storno ausführen</Absenden></div>
      {gutschein && <p className="rounded-lg bg-accent-soft px-3 py-2 text-sm">Gutscheincode: <strong className="font-mono text-base">{gutschein}</strong></p>}
    </AktionForm>
  );
}

/** einzeln: nur dieses eine Ticket stornieren (Ticket-Detailseite) */
export function StornoDialog({ action, tickets, fristAbgelaufen, darfFrist, versteckt, einzeln, anfangsOffen }: { action: Aktion; tickets: TicketZeile[]; fristAbgelaufen: boolean; darfFrist: boolean; versteckt?: boolean; einzeln?: boolean; anfangsOffen?: boolean }) {
  return (
    <DialogKnopf titel={einzeln ? 'Ticket stornieren' : 'Stornieren'} knopf={einzeln ? 'Ticket stornieren' : 'Stornieren'} knopfKlasse="btn-danger" versteckt={versteckt} anfangsOffen={anfangsOffen}>
      <StornoFormular action={action} tickets={tickets} fristAbgelaufen={fristAbgelaufen} darfFrist={darfFrist} einzeln={einzeln} />
    </DialogKnopf>
  );
}

export function UmbuchungDialog({ action, tickets, shows, aktuelleShow, fristAbgelaufen, darfFrist, darfFrei, versteckt, anfangsOffen }: {
  action: (e: UmbuchungEingabe) => Promise<Ergebnis>; tickets: TicketZeile[]; shows: ShowOption[]; aktuelleShow: string; fristAbgelaufen: boolean; darfFrist: boolean; darfFrei: boolean; versteckt?: boolean; anfangsOffen?: boolean;
}) {
  const [alle, setAlle] = useState(true);
  const [ids, setIds] = useState<string[]>([]);
  const [wahl, setWahl] = useState<Wahl>({ showId: '', seats: [], summe: 0 });
  const [nachzahlung, setNachzahlung] = useState<'bar' | 'terminal' | 'rechnung'>('bar');
  const [frist, setFrist] = useState(false);
  const [e, setE] = useState<Ergebnis>();
  const [neuLaden, setNeuLaden] = useState(0);
  const [laeuft, start] = useTransition();
  const alt = (alle ? tickets : tickets.filter((t) => ids.includes(t.id))).reduce((s, t) => s + t.cents, 0);
  const diff = wahl.summe - alt;
  const los = () => start(async () => {
    const r = await action({ ticketIds: alle ? undefined : ids, showId: wahl.showId, seats: wahl.seats, nachzahlung, frist });
    setE(r);
    if (r.daten?.belegt) setNeuLaden((n) => n + 1);
  });
  return (
    <DialogKnopf titel="Umbuchen auf eine andere Vorstellung" knopf="Umbuchen" breit versteckt={versteckt} anfangsOffen={anfangsOffen}>
      {e?.ok ? (
        <div className="grid gap-3"><Meldung e={e} />{typeof e.daten?.neu === 'string' && <Link className="btn-primary w-fit" href={`/bestellungen/${e.daten.neu}`}>Neue Bestellung öffnen</Link>}</div>
      ) : (
        <div className="grid gap-4">
          <fieldset>
            <legend className="label">Welche Tickets?</legend>
            <label className="flex min-h-8 items-center gap-2 text-sm"><input type="radio" checked={alle} onChange={() => setAlle(true)} className="h-4 w-4 accent-accent" />Alle {tickets.length} Tickets</label>
            <label className="flex min-h-8 items-center gap-2 text-sm"><input type="radio" checked={!alle} onChange={() => setAlle(false)} className="h-4 w-4 accent-accent" />Einzelne Tickets</label>
            {!alle && <div className="mt-1 grid gap-1 pl-6">{tickets.map((t) => <label key={t.id} className="flex min-h-8 items-center gap-2 text-sm"><input type="checkbox" checked={ids.includes(t.id)} onChange={(x) => setIds(x.target.checked ? [...ids, t.id] : ids.filter((i) => i !== t.id))} className="h-4 w-4 accent-accent" />{t.label} · {formatEur(t.cents)}</label>)}</div>}
          </fieldset>
          <PlatzWahl shows={shows} darfFrei={darfFrei} onChange={setWahl} neuLaden={neuLaden} ausser={aktuelleShow} />
          <div className="grid gap-3 rounded-lg bg-paper p-3 text-sm sm:grid-cols-2">
            <p>Bisher: <strong className="num">{formatEur(alt)}</strong> · Neu: <strong className="num">{formatEur(wahl.summe)}</strong><br />
              {diff > 0 ? <>Nachzahlung: <strong className="num">{formatEur(diff)}</strong></> : diff < 0 ? <>Restguthaben als Gutschein: <strong className="num">{formatEur(-diff)}</strong></> : 'Kein Preisunterschied.'}</p>
            {diff > 0 && (
              <div><label htmlFor="u-nach" className="label">Nachzahlung per</label>
                <select id="u-nach" value={nachzahlung} onChange={(x) => setNachzahlung(x.target.value as typeof nachzahlung)} className="input"><option value="bar">Bar</option><option value="terminal">Karte (Terminal)</option><option value="rechnung">Rechnung / Überweisung</option></select></div>
            )}
          </div>
          {fristAbgelaufen && (darfFrist
            ? <label className="flex min-h-8 items-center gap-2 rounded-lg bg-amber-50 p-3 text-sm font-semibold text-amber-900"><input type="checkbox" checked={frist} onChange={(x) => setFrist(x.target.checked)} className="h-4 w-4 accent-accent" />Weniger als 24 Stunden vor Beginn – Frist übergehen (Ausnahme durch Leitung)</label>
            : <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Die 24-Stunden-Frist ist vorbei.</p>)}
          <p className="text-xs text-muted">Ablauf: Die alten Tickets werden gegen einen Gutschein storniert, die neuen Plätze mit diesem Gutschein gebucht. Die Kund:in erhält die neuen Tickets per E-Mail.</p>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="btn-primary" disabled={laeuft || !wahl.showId || !wahl.seats.length || (!alle && !ids.length)} onClick={los}>{laeuft ? 'Bitte warten …' : 'Umbuchung ausführen'}</button>
          </div>
          <Meldung e={e} />
        </div>
      )}
    </DialogKnopf>
  );
}

export function ZahlungErhalten({ action, betrag }: { action: Aktion; betrag: number }) {
  return (
    <AktionForm action={action} className="flex flex-wrap items-end gap-3">
      <div><label htmlFor="ze-provider" className="label">Zahlung erhalten über</label>
        <select id="ze-provider" name="provider" className="input" defaultValue="rechnung"><option value="rechnung">Überweisung (Rechnung)</option><option value="bar">Bar</option><option value="terminal">Karte (Terminal)</option></select></div>
      <div><label htmlFor="ze-ref" className="label">Referenz (optional)</label><input id="ze-ref" name="referenz" className="input" placeholder="z. B. Kontoauszug" /></div>
      <Absenden className="btn-gold">Zahlung über {formatEur(betrag)} erhalten</Absenden>
    </AktionForm>
  );
}

export type KundeWerte = { firstName: string; lastName: string; email: string; phone: string; company: string; vatId: string; street: string; zip: string; city: string; country: string; newsletter: boolean };
const KUNDE_FELDER: [keyof KundeWerte, string, string][] = [
  ['firstName', 'Vorname', 'given-name'], ['lastName', 'Nachname', 'family-name'], ['email', 'E-Mail', 'email'], ['phone', 'Telefon', 'tel'],
  ['company', 'Firma', 'organization'], ['vatId', 'UID-Nummer', 'off'], ['street', 'Straße', 'street-address'], ['zip', 'PLZ', 'postal-code'], ['city', 'Ort', 'address-level2'], ['country', 'Land', 'country-name'],
];

export function KundeFormular({ action, werte, prefix = 'kd', onErfolg, knopf = 'Kundendaten speichern' }: { action: Aktion; werte: KundeWerte; prefix?: string; onErfolg?: (e: Ergebnis) => void; knopf?: string }) {
  return (
    <AktionForm action={action} onErfolg={onErfolg}>
      <div className="grid gap-3 sm:grid-cols-2">
        {KUNDE_FELDER.map(([n, l, ac]) => (
          <div key={n}><label htmlFor={`${prefix}-${n}`} className="label">{l}</label><input id={`${prefix}-${n}`} name={n} type={n === 'email' ? 'email' : n === 'phone' ? 'tel' : 'text'} autoComplete={ac} defaultValue={String(werte[n] ?? '')} required={n === 'lastName'} className="input" /></div>
        ))}
      </div>
      <label className="flex min-h-8 items-center gap-2 text-sm"><input type="checkbox" name="newsletter" defaultChecked={werte.newsletter} className="h-4 w-4 accent-accent" />Newsletter (Einwilligung liegt vor)</label>
      <div><Absenden>{knopf}</Absenden></div>
    </AktionForm>
  );
}

/** Kundendaten in der Seitenleiste bearbeiten */
export function KundeBearbeiten({ action, werte, knopf = 'Bearbeiten', untertitel }: { action: Aktion; werte: KundeWerte; knopf?: string; untertitel?: React.ReactNode }) {
  const [offen, setOffen] = useState(false);
  const router = useRouter();
  return (
    <>
      <button type="button" className="btn-secondary btn-sm" onClick={() => setOffen(true)} aria-haspopup="dialog"><Icon name="bearbeiten" className="h-3.5 w-3.5" />{knopf}<span className="sr-only"> – Kundendaten</span></button>
      <Drawer offen={offen} onClose={() => setOffen(false)} titel="Kundendaten bearbeiten" untertitel={untertitel}>
        <KundeFormular action={action} werte={werte} prefix="kdd" onErfolg={(e) => { toast(e.meldung ?? 'Gespeichert'); setOffen(false); router.refresh(); }} />
      </Drawer>
    </>
  );
}

export function NotizFormular({ action, note, prefix = 'notiz', onErfolg, ohneLabel }: { action: Aktion; note: string; prefix?: string; onErfolg?: (e: Ergebnis) => void; ohneLabel?: boolean }) {
  return (
    <AktionForm action={action} className="grid gap-2" onErfolg={onErfolg}>
      <label htmlFor={prefix} className={ohneLabel ? 'sr-only' : 'label'}>Interne Notiz</label>
      <textarea id={prefix} name="note" rows={3} defaultValue={note} className="input" placeholder="Nur intern sichtbar" />
      <div><Absenden className="btn-secondary">Notiz speichern</Absenden></div>
    </AktionForm>
  );
}
