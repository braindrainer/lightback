'use client';
// Telefonverkauf / Kassa-Buchung durch Mitarbeiter:innen
import { useState, useTransition } from 'react';
import { gutscheinPruefenAktion, telefonVerkauf } from '@/app/(app)/bestellungen/actions';
import { formatEur } from '@/lib/money';
import type { Ergebnis } from './ergebnis';
import { Meldung } from './form';
import PlatzWahl, { type ShowOption, type Wahl } from './PlatzWahl';

const ZAHLARTEN = [
  ['bar', 'Bar', 'Gilt sofort als bezahlt, Tickets und Rechnung werden erstellt.'],
  ['terminal', 'Karte (Terminal)', 'Gilt sofort als bezahlt.'],
  ['rechnung', 'Rechnung / Überweisung', 'Bleibt offen, Plätze bleiben bis zur Vorstellung reserviert. Zahlungseingang in der Bestellung erfassen.'],
  ['zahlungslink', 'Zahlungslink', 'Bleibt offen; der Link wird später gesendet.'],
] as const;

const FELDER: [string, string, string, boolean?][] = [
  ['firstName', 'Vorname', 'given-name'], ['lastName', 'Nachname', 'family-name'], ['email', 'E-Mail', 'email'], ['phone', 'Telefon', 'tel'],
];
const RECHNUNG: [string, string, string][] = [
  ['company', 'Firma', 'organization'], ['vatId', 'UID-Nummer', 'off'], ['street', 'Straße und Hausnummer', 'street-address'], ['zip', 'PLZ', 'postal-code'], ['city', 'Ort', 'address-level2'], ['country', 'Land', 'country-name'],
];

export default function TelefonVerkauf({ shows, startShow, darfFrei }: { shows: ShowOption[]; startShow?: string; darfFrei: boolean }) {
  const [wahl, setWahl] = useState<Wahl>({ showId: startShow ?? '', seats: [], summe: 0 });
  const [kunde, setKunde] = useState<Record<string, string>>({});
  const [newsletter, setNewsletter] = useState(false);
  const [rechnungsDaten, setRechnungsDaten] = useState(false);
  const [code, setCode] = useState('');
  const [codeE, setCodeE] = useState<Ergebnis>();
  const [zahlart, setZahlart] = useState<string>('bar');
  const [note, setNote] = useState('');
  const [e, setE] = useState<Ergebnis>();
  const [neuLaden, setNeuLaden] = useState(0);
  const [laeuft, start] = useTransition();

  const rest = typeof codeE?.daten?.rest === 'number' ? Math.min(codeE.daten.rest as number, wahl.summe) : 0;
  const pruefen = () => start(async () => setCodeE(await gutscheinPruefenAktion(code)));
  const absenden = (ev: React.FormEvent) => {
    ev.preventDefault();
    start(async () => {
      const r = await telefonVerkauf({ showId: wahl.showId, seats: wahl.seats, kunde: { ...kunde, newsletter }, voucherCode: code || undefined, zahlart: zahlart as 'bar', note });
      setE(r);
      if (r?.daten?.belegt) setNeuLaden((n) => n + 1);
      if (r?.fehler) document.getElementById('verkauf-meldung')?.focus();
    });
  };
  const feld = ([n, l, ac]: [string, string, string, boolean?]) => (
    <div key={n}>
      <label htmlFor={`k-${n}`} className="label">{l}</label>
      <input id={`k-${n}`} name={n} type={n === 'email' ? 'email' : n === 'phone' ? 'tel' : 'text'} autoComplete={ac} value={kunde[n] ?? ''} onChange={(x) => setKunde({ ...kunde, [n]: x.target.value })} className="input" />
    </div>
  );

  return (
    <form onSubmit={absenden} className="grid gap-6" aria-label="Telefonverkauf">
      <section className="card p-5" aria-labelledby="t-plaetze">
        <h2 id="t-plaetze" className="h2 mb-3">1. Vorstellung und Plätze</h2>
        <PlatzWahl shows={shows} startShow={startShow} darfFrei={darfFrei} onChange={setWahl} neuLaden={neuLaden} />
      </section>

      <section className="card grid gap-4 p-5" aria-labelledby="t-kunde">
        <h2 id="t-kunde" className="h2">2. Kund:in</h2>
        <p className="text-sm text-muted">Bei Barverkauf ohne Namen bleibt die Bestellung anonym. Mit E-Mail-Adresse werden die Tickets per E-Mail gesendet.</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{FELDER.map(feld)}</div>
        <label className="flex min-h-8 items-center gap-2 text-sm"><input type="checkbox" checked={newsletter} onChange={(x) => setNewsletter(x.target.checked)} className="h-4 w-4 accent-accent" />Möchte den Newsletter erhalten (Einwilligung liegt vor)</label>
        <label className="flex min-h-8 items-center gap-2 text-sm"><input type="checkbox" checked={rechnungsDaten} onChange={(x) => setRechnungsDaten(x.target.checked)} aria-controls="t-rechnung" aria-expanded={rechnungsDaten} className="h-4 w-4 accent-accent" />Rechnung an Firma / mit Adresse</label>
        {rechnungsDaten && <div id="t-rechnung" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{RECHNUNG.map(feld)}</div>}
      </section>

      <section className="card grid gap-4 p-5" aria-labelledby="t-zahlung">
        <h2 id="t-zahlung" className="h2">3. Gutschein und Zahlung</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div><label htmlFor="t-code" className="label">Gutscheincode (optional)</label><input id="t-code" value={code} onChange={(x) => { setCode(x.target.value.toUpperCase()); setCodeE(undefined); }} className="input font-mono" autoComplete="off" /></div>
          <button type="button" className="btn-secondary" onClick={pruefen} disabled={!code || laeuft}>Gutschein prüfen</button>
        </div>
        <Meldung e={codeE} />
        <fieldset>
          <legend className="label">Zahlart</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {ZAHLARTEN.map(([k, l, h]) => (
              <label key={k} className="flex cursor-pointer gap-3 rounded-lg border border-line bg-white p-3 has-[:checked]:border-accent has-[:checked]:bg-accent-soft">
                <input type="radio" name="zahlart" value={k} checked={zahlart === k} onChange={() => setZahlart(k)} className="mt-1 h-4 w-4 accent-accent" aria-describedby={`z-${k}`} />
                <span><span className="block text-sm font-semibold">{l}</span><span id={`z-${k}`} className="block text-xs text-muted">{h}</span></span>
              </label>
            ))}
          </div>
        </fieldset>
        <div><label htmlFor="t-note" className="label">Notiz (intern)</label><textarea id="t-note" value={note} onChange={(x) => setNote(x.target.value)} rows={2} className="input" /></div>
      </section>

      <section className="card sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 p-4 shadow-lg" aria-label="Zusammenfassung">
        <div className="text-sm" aria-live="polite">
          <p><strong>{wahl.seats.length} {wahl.seats.length === 1 ? 'Ticket' : 'Tickets'}</strong> · Summe <span className="num font-semibold">{formatEur(wahl.summe)}</span></p>
          {rest > 0 && <p className="text-muted">Gutschein −{formatEur(rest)} · zu zahlen <span className="num font-semibold text-ink">{formatEur(wahl.summe - rest)}</span></p>}
        </div>
        <button type="submit" className="btn-gold" disabled={laeuft || !wahl.showId || !wahl.seats.length}>{laeuft ? 'Bitte warten …' : 'Verbindlich buchen'}</button>
        <div id="verkauf-meldung" tabIndex={-1} className="basis-full empty:hidden"><Meldung e={e} /></div>
      </section>
    </form>
  );
}
