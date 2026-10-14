'use client';
import { useState } from 'react';
import type { Ergebnis } from './ergebnis';
import { Absenden, AktionForm } from './form';
import { Icon } from '@/components/icons';
import { Modal, toast } from '@/components/ui-client';

type Aktion = (p: Ergebnis, fd: FormData) => Promise<Ergebnis>;

function Codes({ codes }: { codes?: string[] }) {
  if (!codes?.length) return null;
  return (
    <div className="grid gap-1">
      <label htmlFor="neue-codes" className="label">Neue Codes ({codes.length})</label>
      <textarea id="neue-codes" readOnly value={codes.join('\n')} rows={Math.min(8, codes.length)} className="input font-mono" onFocus={(e) => e.currentTarget.select()} />
    </div>
  );
}

export function AusstellenFormular({ action }: { action: Aktion }) {
  const [codes, setCodes] = useState<string[]>();
  return (
    <AktionForm action={action} onErfolg={(e) => setCodes(e.daten?.codes as string[])}>
      <div className="grid gap-3 sm:grid-cols-3">
        <div><label htmlFor="a-wert" className="label">Wert in €</label><input id="a-wert" name="wert" inputMode="decimal" required className="input num" placeholder="28,00" /></div>
        <div><label htmlFor="a-anzahl" className="label">Anzahl</label><input id="a-anzahl" name="anzahl" type="number" min={1} max={500} defaultValue={1} required className="input" /></div>
        <div><label htmlFor="a-gueltig" className="label">Gültig bis (leer = 3 Jahre)</label><input id="a-gueltig" name="gueltig" type="date" className="input" /></div>
      </div>
      <div><label htmlFor="a-note" className="label">Anlass / Notiz</label><input id="a-note" name="note" required placeholder="z. B. Gewinnspiel Ö1, Kulanz" className="input" /></div>
      <p className="text-xs text-muted">Ohne Zahlung, daher keine Buchung beim Ausstellen.</p>
      <div><Absenden>Gutscheine ausstellen</Absenden></div>
      <Codes codes={codes} />
    </AktionForm>
  );
}

export function VerkaufenFormular({ action }: { action: Aktion }) {
  const [codes, setCodes] = useState<string[]>();
  return (
    <AktionForm action={action} onErfolg={(e) => setCodes(e.daten?.codes as string[])}>
      <div className="grid gap-3 sm:grid-cols-3">
        <div><label htmlFor="v-wert" className="label">Wert in €</label><input id="v-wert" name="wert" inputMode="decimal" required className="input num" placeholder="50,00" /></div>
        <div><label htmlFor="v-provider" className="label">Bezahlt mit</label><select id="v-provider" name="provider" className="input"><option value="bar">Bar</option><option value="terminal">Karte (Terminal)</option></select></div>
        <div><label htmlFor="v-note" className="label">Notiz</label><input id="v-note" name="note" className="input" /></div>
      </div>
      <p className="text-xs text-muted">Gültig 3 Jahre. Wird als Gutscheinverbindlichkeit gebucht (ohne USt).</p>
      <div><Absenden className="btn-gold">Gutschein verkaufen</Absenden></div>
      <Codes codes={codes} />
    </AktionForm>
  );
}

export function ImportFormular({ action }: { action: Aktion }) {
  return (
    <AktionForm action={action} zuruecksetzen>
      <div className="grid gap-3 sm:grid-cols-3">
        <div><label htmlFor="i-issuer" className="label">Partner</label><input id="i-issuer" name="issuer" list="partnerliste" required className="input" placeholder="Tiqets" />
          <datalist id="partnerliste"><option value="Tiqets" /><option value="HelloTickets" /><option value="GetYourGuide" /><option value="Musement" /></datalist></div>
        <div><label htmlFor="i-wert" className="label">Wert je Code in € (falls nicht in der Zeile)</label><input id="i-wert" name="standardwert" inputMode="decimal" className="input num" placeholder="28,00" /></div>
        <div><label htmlFor="i-gueltig" className="label">Gültig bis (optional)</label><input id="i-gueltig" name="gueltig" type="date" className="input" /></div>
      </div>
      <div>
        <label htmlFor="i-codes" className="label">Codes, einer je Zeile</label>
        <textarea id="i-codes" name="codes" required rows={8} className="input font-mono" aria-describedby="i-codes-hilfe" placeholder={'TQ-12345678\nTQ-87654321;24,00'} />
        <p id="i-codes-hilfe" className="mt-1 text-xs text-muted">Format: CODE oder CODE;Wert. Vorhandene Codes werden übersprungen. Partner-Gutscheine werden beim Import nicht gebucht (Abrechnung über den Partner).</p>
      </div>
      <div><Absenden>Codes importieren</Absenden></div>
    </AktionForm>
  );
}

/** „Per E-Mail senden“: kleiner Dialog mit Empfänger */
export function GutscheinSenden({ action, code, deaktiviert }: { action: Aktion; code: string; deaktiviert?: boolean }) {
  const [offen, setOffen] = useState(false);
  return (
    <>
      <button type="button" className="btn-secondary" onClick={() => setOffen(true)} aria-haspopup="dialog" disabled={deaktiviert}><Icon name="mail" className="h-4 w-4" />Per E-Mail senden</button>
      <Modal offen={offen} onClose={() => setOffen(false)} titel="Gutschein per E-Mail senden">
        <p className="text-sm text-muted">Die Empfänger:in bekommt den Gutschein <span className="font-mono text-ink">{code}</span> als Karte mit QR-Code (Vorlage „Gutschein per E-Mail“).</p>
        <AktionForm action={action} onErfolg={(e) => { toast(e.meldung ?? 'Gesendet'); setOffen(false); }}>
          <div><label htmlFor="gs-an" className="label">E-Mail-Adresse</label><input id="gs-an" name="an" type="email" required autoComplete="off" className="input" /></div>
          <div><label htmlFor="gs-name" className="label">Name für die Anrede (optional)</label><input id="gs-name" name="name" autoComplete="off" className="input" placeholder="z. B. Frau Muster" /></div>
          <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={() => setOffen(false)}>Abbrechen</button><Absenden>Senden</Absenden></div>
        </AktionForm>
      </Modal>
    </>
  );
}
