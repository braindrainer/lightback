import { requireRole } from '@/lib/auth';
import { getSettings } from '@/lib/db';
import { Formular } from '@/components/system/Formular';
import { PageHeader } from '@/components/ui';
import { MODUL_KEYS, MODULE, modulStand } from '@/lib/module';
import { demoSpeichern, firmaSpeichern, moduleSpeichern, mailSpeichern, rechnungenSpeichern, vorstellungenSpeichern, zahlungSpeichern } from './actions';
import { MailTest } from './MailTest';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Einstellungen' };

type Konfig = {
  hobex?: { entityId?: string; tokenEnc?: string; live?: boolean };
  stripe?: { publishableKey?: string; secretKeyEnc?: string; webhookSecretEnc?: string };
  paypal?: { clientId?: string; secretEnc?: string; live?: boolean };
};

function Feld({ name, label, wert, typ = 'text', hinweis, pflicht, auto = 'off', breit, ...rest }: { name: string; label: string; wert?: string | number; typ?: string; hinweis?: string; pflicht?: boolean; auto?: string; breit?: boolean } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className={breit ? 'sm:col-span-2' : ''}>
      <label htmlFor={name} className="label">{label}</label>
      <input id={name} name={name} type={typ} defaultValue={wert} required={pflicht} autoComplete={auto} aria-describedby={hinweis ? `${name}-h` : undefined} className="input" {...rest} />
      {hinweis && <p id={`${name}-h`} className="mt-1 text-xs text-muted">{hinweis}</p>}
    </div>
  );
}

/** Feld für ein gespeichertes Geheimnis: wird nie zurückgezeigt */
function GeheimFeld({ name, label, gesetzt, hinweis }: { name: string; label: string; gesetzt: boolean; hinweis?: string }) {
  return (
    <Feld name={name} label={label} typ="password" auto="new-password" placeholder={gesetzt ? '•••••• gespeichert – leer lassen = unverändert' : 'nicht gesetzt'}
      hinweis={`${gesetzt ? 'Gespeichert (verschlüsselt). Leer lassen = unverändert, „-“ eingeben = löschen.' : 'Noch nicht gesetzt.'}${hinweis ? ' ' + hinweis : ''}`} />
  );
}

function Modus({ name, label, live }: { name: string; label: string; live?: boolean }) {
  return (
    <fieldset className="sm:col-span-2">
      <legend className="label">{label}</legend>
      <div className="flex flex-wrap gap-4">
        <label className="flex min-h-10 items-center gap-2 text-sm"><input type="radio" name={name} value="test" defaultChecked={!live} className="h-4 w-4 accent-[#6e5118]" /> Test / Sandbox</label>
        <label className="flex min-h-10 items-center gap-2 text-sm"><input type="radio" name={name} value="live" defaultChecked={!!live} className="h-4 w-4 accent-[#6e5118]" /> Live</label>
      </div>
    </fieldset>
  );
}

function Url({ label, url, hinweis }: { label: string; url: string; hinweis?: string }) {
  return (
    <div className="sm:col-span-2 rounded-lg bg-paper px-3 py-2">
      <p className="text-xs font-semibold text-muted">{label}</p>
      <code className="break-all font-mono text-[13px]">{url}</code>
      {hinweis && <p className="mt-0.5 text-xs text-muted">{hinweis}</p>}
    </div>
  );
}

const ABSCHNITTE = [['funktionen', 'Funktionen'], ['firma', 'Firma'], ['rechnungen', 'Rechnungen'], ['vorstellungen', 'Vorstellungen'], ['email', 'E-Mail'], ['zahlung', 'Zahlungsanbieter'], ['demo', 'Demo-Modus']] as const;

export default async function Einstellungen() {
  await requireRole('einstellungen');
  const s = await getSettings();
  const k = (s.paymentConfig ?? {}) as Konfig;
  const m = modulStand(s.module);
  const app = (process.env.APP_ORIGIN ?? 'https://lightback.skillful.at').replace(/\/$/, '');
  return (
    <>
      <PageHeader krumen={[{ label: 'System' }, { label: 'Einstellungen' }]} title="Einstellungen" sub="Firmendaten, Nummernkreise, Mailversand und Zahlungsanbieter – nur für die Administration." />
      <nav aria-label="Abschnitte" className="mb-5 flex flex-wrap gap-2">
        {ABSCHNITTE.map(([id, l]) => <a key={id} href={`#${id}`} className="btn-secondary btn-sm">{l}</a>)}
      </nav>
      <div className="grid max-w-4xl gap-6">
        <Formular action={moduleSpeichern} knopf="Funktionen speichern" className="card p-5">
          <h2 id="funktionen" className="h2 scroll-mt-6">Funktionen</h2>
          <p className="mt-1 mb-4 text-sm text-muted">Was dieser Veranstalter nutzt. Ausgeschaltete Bereiche verschwinden aus Menü und Shop, ihre Schnittstellen antworten mit 403. Daten bleiben erhalten.</p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {MODUL_KEYS.map((key) => (
              <li key={key}>
                <label className="flex h-full gap-3 rounded-lg border border-line p-3">
                  <input type="checkbox" name={`modul_${key}`} defaultChecked={m[key]} className="mt-0.5 h-5 w-5 shrink-0 accent-[#6e5118]" aria-describedby={`modul-${key}-h`} />
                  <span><span className="font-semibold">{MODULE[key].name}</span><span id={`modul-${key}-h`} className="mt-0.5 block text-xs text-muted">{MODULE[key].text}</span></span>
                </label>
              </li>
            ))}
          </ul>
        </Formular>

        <Formular action={firmaSpeichern} knopf="Firmendaten speichern" className="card p-5">
          <h2 id="firma" className="h2 mb-3 scroll-mt-6">Firma</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Feld name="companyName" label="Firmenname" wert={s.companyName} pflicht breit auto="organization" />
            <Feld name="street" label="Straße" wert={s.street} pflicht auto="street-address" />
            <div className="grid grid-cols-[7rem_1fr] gap-3"><Feld name="zip" label="PLZ" wert={s.zip} pflicht auto="postal-code" /><Feld name="city" label="Ort" wert={s.city} pflicht /></div>
            <Feld name="country" label="Land" wert={s.country} pflicht />
            <Feld name="managingDirector" label="Geschäftsführung" wert={s.managingDirector} />
            <Feld name="fn" label="Firmenbuchnummer" wert={s.fn} />
            <Feld name="court" label="Firmenbuchgericht" wert={s.court} />
            <Feld name="uid" label="UID-Nummer" wert={s.uid} />
            <Feld name="email" label="E-Mail" wert={s.email} typ="email" pflicht />
            <Feld name="phone" label="Telefon" wert={s.phone} typ="tel" />
            <Feld name="iban" label="IBAN" wert={s.iban} hinweis="Steht auf Rechnungen" />
            <Feld name="bic" label="BIC" wert={s.bic} />
          </div>
        </Formular>

        <Formular action={rechnungenSpeichern} knopf="Nummernkreise speichern" className="card p-5">
          <h2 id="rechnungen" className="h2 mb-3 scroll-mt-6">Rechnungen und Bestellnummern</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <Feld name="invoicePrefix" label="Rechnungspräfix" wert={s.invoicePrefix} />
            <Feld name="invoiceNumberFmt" label="Format Rechnungsnummer" wert={s.invoiceNumberFmt} pflicht hinweis="Platzhalter: {PREFIX} {YYYY} {YY} {MM} {NNNNN}" />
            <Feld name="orderPrefix" label="Präfix Bestellnummer" wert={s.orderPrefix} pflicht hinweis={`Ergibt ${s.orderPrefix}-${new Date().getFullYear()}-000123`} />
          </div>
          <p className="mt-3 text-xs text-muted">Bestehende Nummern bleiben unverändert. Rechnungsnummern laufen lückenlos weiter.</p>
        </Formular>

        <Formular action={vorstellungenSpeichern} knopf="Speichern" className="card p-5">
          <h2 id="vorstellungen" className="h2 mb-3 scroll-mt-6">Vorstellungen</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Feld name="reservierungVerfallMin" label="Unbezahlte Reservierungen verfallen (Minuten vor Beginn)" wert={s.reservierungVerfallMin} typ="number" min={0} max={1440} pflicht hinweis="Telefon, Rechnung, Zahlungslink. Danach sind die Plätze frei für die Abendkasse. 0 = erst zu Beginn." />
            <label className="flex min-h-10 items-center gap-2 self-center text-sm"><input type="checkbox" name="reservierungVerfallMail" defaultChecked={s.reservierungVerfallMail} className="h-4 w-4 accent-[#6e5118]" /> Kund:in per E-Mail informieren</label>
          </div>
        </Formular>

        <section aria-labelledby="email" className="card p-5">
          <h2 id="email" className="h2 mb-3 scroll-mt-6">E-Mail-Versand</h2>
          <Formular action={mailSpeichern} knopf="E-Mail-Einstellungen speichern">
            <div className="grid gap-4 sm:grid-cols-2">
              <Feld name="smtpHost" label="SMTP-Server" wert={s.smtpHost} hinweis="Leer = es wird nichts verschickt (nur Protokoll)" />
              <Feld name="smtpPort" label="Port" wert={s.smtpPort} typ="number" min={1} max={65535} hinweis="587 (STARTTLS) oder 465 (SSL)" />
              <Feld name="smtpUser" label="Benutzer" wert={s.smtpUser} />
              <GeheimFeld name="smtpPass" label="Passwort" gesetzt={!!s.smtpPassEnc} />
              <Feld name="mailFrom" label="Absender" wert={s.mailFrom} pflicht hinweis='z. B. Light of Creation <office@light-of-creation.com>' />
              <Feld name="mailBcc" label="Kopie (Bcc) an" wert={s.mailBcc} typ="email" hinweis="Optional: jede Mail zusätzlich an diese Adresse" />
            </div>
            {s.smtpPassEnc && <label className="mt-3 flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" name="smtpPassLoeschen" className="h-4 w-4 accent-[#6e5118]" /> Gespeichertes Passwort löschen</label>}
          </Formular>
          <div className="mt-4 border-t border-line pt-4"><MailTest /><p className="mt-1 text-xs text-muted">Prüft die gespeicherten Einstellungen (Verbindung und Anmeldung), ohne eine Mail zu senden.</p></div>
        </section>

        <Formular action={zahlungSpeichern} knopf="Zahlungsanbieter speichern" className="card p-5">
          <h2 id="zahlung" className="h2 scroll-mt-6">Zahlungsanbieter</h2>
          <p className="mt-1 mb-4 text-sm text-muted">Schlüssel und Geheimnisse werden verschlüsselt gespeichert und nie wieder angezeigt. Ist der Demo-Modus an, werden alle Zahlungen simuliert.</p>
          <fieldset className="grid gap-4 rounded-lg border border-line p-4 sm:grid-cols-2">
            <legend className="px-1 text-sm font-semibold">hobex (Karte, Apple Pay)</legend>
            <Feld name="hobexEntity" label="Entity-ID" wert={k.hobex?.entityId ?? ''} />
            <GeheimFeld name="hobexToken" label="Access Token" gesetzt={!!k.hobex?.tokenEnc} />
            <Modus name="hobexLive" label="Umgebung" live={k.hobex?.live} />
            <Url label="Rücksprung-Adresse (shopperResultUrl, setzt das Backend selbst)" url={`${app}/api/zahlung/hobex/return`} />
          </fieldset>
          <fieldset className="mt-4 grid gap-4 rounded-lg border border-line p-4 sm:grid-cols-2">
            <legend className="px-1 text-sm font-semibold">Stripe</legend>
            <Feld name="stripePk" label="Publishable Key" wert={k.stripe?.publishableKey ?? ''} hinweis="pk_live_… oder pk_test_…" />
            <GeheimFeld name="stripeSk" label="Secret Key" gesetzt={!!k.stripe?.secretKeyEnc} hinweis="sk_live_… oder sk_test_…" />
            <GeheimFeld name="stripeWh" label="Webhook-Geheimnis" gesetzt={!!k.stripe?.webhookSecretEnc} hinweis="whsec_…" />
            <Url label="Webhook-URL im Stripe-Dashboard eintragen" url={`${app}/api/zahlung/stripe/webhook`} hinweis="Ereignisse: payment_intent.succeeded, payment_intent.payment_failed, charge.refunded" />
          </fieldset>
          <fieldset className="mt-4 grid gap-4 rounded-lg border border-line p-4 sm:grid-cols-2">
            <legend className="px-1 text-sm font-semibold">PayPal</legend>
            <Feld name="paypalId" label="Client-ID" wert={k.paypal?.clientId ?? ''} />
            <GeheimFeld name="paypalSecret" label="Secret" gesetzt={!!k.paypal?.secretEnc} />
            <Modus name="paypalLive" label="Umgebung" live={k.paypal?.live} />
            <Url label="Rücksprung-Adresse (setzt das Backend bei jeder Zahlung selbst)" url={`${app}/api/zahlung/paypal/return`} />
          </fieldset>
        </Formular>

        <Formular action={demoSpeichern} knopf="Demo-Modus speichern" variante="btn-danger" bestaetigen="Demo-Modus wirklich umstellen? Das betrifft sofort alle Zahlungen und E-Mails." className="card border-2 p-5">
          <h2 id="demo" className="h2 scroll-mt-6">Demo-Modus</h2>
          <p className="mt-1 text-sm">Im Demo-Modus werden <strong>alle Zahlungen simuliert</strong> (Testkarte 4111 1111 1111 1111 klappt, 4000 0000 0000 0002 wird abgelehnt) und <strong>keine E-Mails verschickt</strong> – sie stehen nur im Protokoll.</p>
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-warn"><strong>Achtung:</strong> Ist der Demo-Modus im Echtbetrieb an, bekommen Kund:innen Tickets, ohne zu bezahlen. Vor dem Ausschalten Zahlungsanbieter und SMTP einrichten und testen.</p>
          <fieldset className="mt-3">
            <legend className="label">Status</legend>
            <div className="flex flex-wrap gap-4">
              <label className="flex min-h-10 items-center gap-2 text-sm"><input type="radio" name="demoMode" value="an" defaultChecked={s.demoMode} className="h-4 w-4 accent-[#6e5118]" /> An (simuliert)</label>
              <label className="flex min-h-10 items-center gap-2 text-sm"><input type="radio" name="demoMode" value="aus" defaultChecked={!s.demoMode} className="h-4 w-4 accent-[#6e5118]" /> Aus (Echtbetrieb)</label>
            </div>
          </fieldset>
        </Formular>
      </div>
    </>
  );
}
