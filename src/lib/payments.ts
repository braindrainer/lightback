// Zahlungsanbieter: hobex (Karte, Apple Pay über Open Payment Platform), Stripe, PayPal.
// Im Demo-Modus (Einstellungen) oder ohne Zugangsdaten läuft alles über den Demo-Anbieter:
// Testkarte 4111 1111 1111 1111 klappt, 4000 0000 0000 0002 wird abgelehnt.
import { modulListe } from './module';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { getSettings } from './db';
import { decrypt } from './secret';

export type Anbieter = 'hobex' | 'stripe' | 'paypal' | 'applepay';
export type Start = {
  status: 'bezahlt' | 'abgelehnt' | 'weiter';
  providerRef: string;
  /** Für "weiter": Ziel für Redirect (PayPal) oder Daten für das eingebettete Formular (hobex/Stripe) */
  redirectUrl?: string;
  clientData?: Record<string, string>;
  fehler?: string;
  raw?: unknown;
};
type Konfig = {
  hobex?: { entityId?: string; tokenEnc?: string; live?: boolean };
  stripe?: { publishableKey?: string; secretKeyEnc?: string; webhookSecretEnc?: string };
  paypal?: { clientId?: string; secretEnc?: string; live?: boolean };
};

const ent = (s?: string) => (s ? decrypt(s) : '');

async function konfig(): Promise<{ demo: boolean; k: Konfig }> {
  const s = await getSettings();
  return { demo: s.demoMode, k: (s.paymentConfig ?? {}) as Konfig };
}

/** Welche Anbieter sind eingerichtet? (für Kasse und Einstellungen) */
export async function verfuegbar() {
  const { demo, k } = await konfig();
  const m = await modulListe();
  return {
    demo,
    hobex: m.hobex && (demo || !!(k.hobex?.entityId && k.hobex?.tokenEnc)),
    stripe: m.stripe && (demo || !!k.stripe?.secretKeyEnc),
    paypal: m.paypal && (demo || !!(k.paypal?.clientId && k.paypal?.secretEnc)),
  };
}

// ───────── Demo ─────────
function demoStart(betrag: number, karte?: string): Start {
  const nr = (karte ?? '').replace(/\D/g, '');
  if (nr === '4000000000000002') return { status: 'abgelehnt', providerRef: `demo_${Date.now()}`, fehler: 'Die Bank hat die Zahlung abgelehnt (Demo).' };
  return { status: 'bezahlt', providerRef: `demo_${Date.now().toString(36)}_${betrag}` };
}

// ───────── hobex (Open Payment Platform, COPYandPAY) ─────────
const oppBase = (live?: boolean) => (live ? 'https://eu-prod.oppwa.com' : 'https://eu-test.oppwa.com');

async function hobexCheckout(k: NonNullable<Konfig['hobex']>, betrag: number, ref: string): Promise<Start> {
  const body = new URLSearchParams({ entityId: k.entityId!, amount: (betrag / 100).toFixed(2), currency: 'EUR', paymentType: 'DB', merchantTransactionId: ref });
  const r = await fetch(`${oppBase(k.live)}/v1/checkouts`, { method: 'POST', headers: { Authorization: `Bearer ${ent(k.tokenEnc)}` }, body });
  const j = await r.json();
  if (!j.id) return { status: 'abgelehnt', providerRef: '', fehler: j.result?.description ?? 'hobex nicht erreichbar', raw: j };
  return { status: 'weiter', providerRef: j.id, clientData: { checkoutId: j.id, script: `${oppBase(k.live)}/v1/paymentWidgets.js?checkoutId=${j.id}` }, raw: j };
}

/** Ergebnis eines hobex-Checkouts abfragen (nach Rückkehr vom Formular) */
export async function hobexStatus(checkoutId: string): Promise<Start> {
  const { k } = await konfig();
  const h = k.hobex!;
  const r = await fetch(`${oppBase(h.live)}/v1/checkouts/${encodeURIComponent(checkoutId)}/payment?entityId=${h.entityId}`, { headers: { Authorization: `Bearer ${ent(h.tokenEnc)}` } });
  const j = await r.json();
  const ok = /^(000\.000\.|000\.100\.1|000\.[36])/.test(j.result?.code ?? '');
  return { status: ok ? 'bezahlt' : 'abgelehnt', providerRef: j.id ?? checkoutId, fehler: ok ? undefined : j.result?.description, raw: j };
}

// ───────── Stripe (PaymentIntents, ohne SDK) ─────────
async function stripe(path: string, k: NonNullable<Konfig['stripe']>, body?: Record<string, string>) {
  const r = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${ent(k.secretKeyEnc)}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body ? new URLSearchParams(body) : undefined,
  });
  return r.json();
}

async function stripeStart(k: NonNullable<Konfig['stripe']>, betrag: number, ref: string): Promise<Start> {
  const j = await stripe('payment_intents', k, { amount: String(betrag), currency: 'eur', 'automatic_payment_methods[enabled]': 'true', 'metadata[order]': ref, description: `Light of Creation ${ref}` });
  if (!j.id) return { status: 'abgelehnt', providerRef: '', fehler: j.error?.message ?? 'Stripe nicht erreichbar', raw: j };
  return { status: 'weiter', providerRef: j.id, clientData: { clientSecret: j.client_secret, publishableKey: k.publishableKey ?? '' }, raw: j };
}

export async function stripeStatus(intentId: string): Promise<Start> {
  const { k } = await konfig();
  const j = await stripe(`payment_intents/${encodeURIComponent(intentId)}`, k.stripe!);
  return { status: j.status === 'succeeded' ? 'bezahlt' : j.status === 'canceled' || j.status === 'requires_payment_method' ? 'abgelehnt' : 'weiter', providerRef: j.id, raw: j };
}

/** Stripe-Webhook-Signatur prüfen (Header "Stripe-Signature") */
export async function stripeWebhookPruefen(payload: string, header: string): Promise<boolean> {
  const { k } = await konfig();
  const secret = ent(k.stripe?.webhookSecretEnc);
  if (!secret) return false;
  const t = header.match(/t=(\d+)/)?.[1];
  const v1 = [...header.matchAll(/v1=([a-f0-9]+)/g)].map((m) => m[1]);
  if (!t || Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const soll = createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
  return v1.some((v) => v.length === soll.length && timingSafeEqual(Buffer.from(v), Buffer.from(soll)));
}

// ───────── PayPal (Orders v2) ─────────
const ppBase = (live?: boolean) => (live ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com');
async function ppToken(k: NonNullable<Konfig['paypal']>) {
  const r = await fetch(`${ppBase(k.live)}/v1/oauth2/token`, { method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${k.clientId}:${ent(k.secretEnc)}`).toString('base64')}` }, body: new URLSearchParams({ grant_type: 'client_credentials' }) });
  return (await r.json()).access_token as string;
}
async function paypalStart(k: NonNullable<Konfig['paypal']>, betrag: number, ref: string, rueck: string): Promise<Start> {
  const tok = await ppToken(k);
  const r = await fetch(`${ppBase(k.live)}/v2/checkout/orders`, {
    method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ intent: 'CAPTURE', purchase_units: [{ reference_id: ref, amount: { currency_code: 'EUR', value: (betrag / 100).toFixed(2) } }], application_context: { return_url: rueck, cancel_url: rueck, user_action: 'PAY_NOW' } }),
  });
  const j = await r.json();
  const link = j.links?.find((l: { rel: string }) => l.rel === 'approve')?.href;
  if (!link) return { status: 'abgelehnt', providerRef: '', fehler: 'PayPal nicht erreichbar', raw: j };
  return { status: 'weiter', providerRef: j.id, redirectUrl: link, raw: j };
}
export async function paypalCapture(orderId: string): Promise<Start> {
  const { k } = await konfig();
  const tok = await ppToken(k.paypal!);
  const r = await fetch(`${ppBase(k.paypal!.live)}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, { method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } });
  const j = await r.json();
  const cap = j.purchase_units?.[0]?.payments?.captures?.[0];
  return { status: j.status === 'COMPLETED' ? 'bezahlt' : 'abgelehnt', providerRef: cap?.id ?? orderId, raw: j };
}

// ───────── Einstieg ─────────

/** Zahlung starten. ref = Bestellnummer, rueck = Rücksprung-URL (PayPal) */
export async function zahlungStarten(anbieter: Anbieter, betrag: number, ref: string, opt: { rueck?: string; demoKarte?: string } = {}): Promise<Start> {
  const { demo, k } = await konfig();
  const m = await modulListe();
  if (!m[anbieter === 'applepay' ? 'hobex' : anbieter]) return { status: 'abgelehnt', providerRef: '', fehler: `${anbieter} ist ausgeschaltet` };
  if (demo) return demoStart(betrag, opt.demoKarte);
  if ((anbieter === 'hobex' || anbieter === 'applepay') && k.hobex?.entityId) return hobexCheckout(k.hobex, betrag, ref);
  if (anbieter === 'stripe' && k.stripe?.secretKeyEnc) return stripeStart(k.stripe, betrag, ref);
  if (anbieter === 'paypal' && k.paypal?.clientId) return paypalStart(k.paypal, betrag, ref, opt.rueck ?? '');
  return { status: 'abgelehnt', providerRef: '', fehler: `${anbieter} ist nicht eingerichtet` };
}

/** Erstattung über den ursprünglichen Anbieter. providerRef = Zahlungs-ID beim Anbieter */
export async function erstatten(anbieter: string, providerRef: string, betrag: number): Promise<{ ok: boolean; ref: string; fehler?: string }> {
  const { demo, k } = await konfig();
  if (demo || providerRef.startsWith('demo_')) return { ok: true, ref: `demo_rf_${Date.now().toString(36)}` };
  try {
    if ((anbieter === 'hobex' || anbieter === 'applepay') && k.hobex) {
      const r = await fetch(`${oppBase(k.hobex.live)}/v1/payments/${encodeURIComponent(providerRef)}`, { method: 'POST', headers: { Authorization: `Bearer ${ent(k.hobex.tokenEnc)}` }, body: new URLSearchParams({ entityId: k.hobex.entityId!, amount: (betrag / 100).toFixed(2), currency: 'EUR', paymentType: 'RF' }) });
      const j = await r.json();
      const ok = /^(000\.000\.|000\.100\.1)/.test(j.result?.code ?? '');
      return { ok, ref: j.id ?? '', fehler: ok ? undefined : j.result?.description };
    }
    if (anbieter === 'stripe' && k.stripe) {
      const j = await stripe('refunds', k.stripe, { payment_intent: providerRef, amount: String(betrag) });
      return { ok: !!j.id && j.status !== 'failed', ref: j.id ?? '', fehler: j.error?.message };
    }
    if (anbieter === 'paypal' && k.paypal) {
      const tok = await ppToken(k.paypal);
      const r = await fetch(`${ppBase(k.paypal.live)}/v2/payments/captures/${encodeURIComponent(providerRef)}/refund`, { method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ amount: { value: (betrag / 100).toFixed(2), currency_code: 'EUR' } }) });
      const j = await r.json();
      return { ok: j.status === 'COMPLETED' || j.status === 'PENDING', ref: j.id ?? '', fehler: j.message };
    }
  } catch (e) {
    return { ok: false, ref: '', fehler: (e as Error).message };
  }
  return { ok: false, ref: '', fehler: `Erstattung über ${anbieter} nicht möglich – bitte manuell überweisen` };
}
