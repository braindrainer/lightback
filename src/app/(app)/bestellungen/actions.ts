'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { aenderung, audit, protokoll } from '@/lib/audit';
import { rechnungSenden } from '@/lib/finanzen/rechnungen';
import { assertRole, hat } from '@/lib/auth';
import { db } from '@/lib/db';
import { formatEur, parseAmountToCents } from '@/lib/money';
import { bestellungAnlegen, bezahlt, gutscheinPruefen, rechnungFuerBestellung, stornieren, stornoMoeglich, ticketMail } from '@/lib/orders';
import { sitzName, SITZ } from '@/lib/saal';
import { freigeben, haltenBis, MAX_TICKETS, PlatzBelegt, reservieren } from '@/lib/seats';
import { umbuchen } from '@/lib/umbuchung';
import { ausfuehren, type Ergebnis } from '@/components/verkauf/ergebnis';
import { ART_NAME, KAT_NAME } from '@/components/verkauf/texte';

const obj = (fd: FormData) => Object.fromEntries(fd.entries());
const opt = z.string().trim().max(200).optional().transform((v) => v || undefined);
const kundeSchema = z.object({
  firstName: z.string().trim().max(100).default(''),
  lastName: z.string().trim().max(100).default(''),
  email: z.union([z.literal(''), z.email('E-Mail-Adresse ist ungültig')]).default(''),
  phone: opt, company: opt, vatId: opt, street: opt, zip: opt, city: opt, country: opt,
  newsletter: z.boolean().optional(),
});
const plaetzeSchema = z.array(z.object({ seatId: z.string().refine((id) => !!SITZ[id], 'Unbekannter Platz'), art: z.enum(['normal', 'ermaessigt', 'frei']) })).min(1, 'Bitte Plätze wählen').max(MAX_TICKETS, `Höchstens ${MAX_TICKETS} Plätze je Bestellung`);

function belegtMeldung(e: PlatzBelegt): Ergebnis {
  return { fehler: `Diese Plätze sind inzwischen vergeben: ${e.seats.map(sitzName).join(', ')}. Bitte andere wählen.`, daten: { belegt: e.seats } };
}

// ───────── Telefonverkauf ─────────

const verkaufSchema = z.object({
  showId: z.string().min(1, 'Bitte eine Vorstellung wählen'),
  seats: plaetzeSchema,
  kunde: kundeSchema,
  voucherCode: z.string().trim().max(40).optional(),
  zahlart: z.enum(['bar', 'terminal', 'rechnung', 'zahlungslink']),
  note: z.string().trim().max(1000).default(''),
});
export type VerkaufEingabe = z.input<typeof verkaufSchema>;

export async function telefonVerkauf(eingabe: VerkaufEingabe): Promise<Ergebnis> {
  let fertig = '';
  const e = await ausfuehren(async () => {
    const u = await assertRole('leitung', 'kassa');
    const d = verkaufSchema.parse(eingabe);
    if (d.seats.some((s) => s.art === 'frei') && !hat(u, 'leitung')) throw new Error('Freikarten darf nur die Leitung ausgeben');
    const k = d.kunde;
    const mitKunde = !!(k.firstName || k.lastName || k.email);
    if (['rechnung', 'zahlungslink'].includes(d.zahlart)) {
      if (!k.lastName) throw new Error('Für Rechnung oder Zahlungslink bitte den Namen angeben');
      if (d.zahlart === 'zahlungslink' && !k.email) throw new Error('Für den Zahlungslink wird eine E-Mail-Adresse gebraucht');
    }
    if (mitKunde && !k.lastName) throw new Error('Bitte den Nachnamen angeben');
    const show = await db.show.findUniqueOrThrow({ where: { id: d.showId } });
    let hold;
    try {
      hold = await reservieren(d.showId, d.seats);
    } catch (x) {
      if (x instanceof PlatzBelegt) return belegtMeldung(x);
      throw x;
    }
    let order;
    try {
      const note = [d.note, d.zahlart === 'zahlungslink' ? 'Zahlungslink ausständig' : d.zahlart === 'rechnung' ? 'Zahlung per Rechnung ausständig' : ''].filter(Boolean).join(' · ');
      order = await bestellungAnlegen({ holdToken: hold.token, kunde: mitKunde ? { ...k, email: k.email ?? '' } : undefined, channel: 'telefon', voucherCode: d.voucherCode || undefined, createdById: u.id, note });
    } catch (x) {
      await freigeben(hold.token);
      throw x;
    }
    const zahl = order.totalCents - order.voucherCents;
    if (zahl === 0) await bezahlt(order.id, { provider: order.voucherCents ? 'gutschein' : 'bar', providerRef: order.voucherCode ?? `tel-${order.number}`, amountCents: 0 });
    else if (d.zahlart === 'bar' || d.zahlart === 'terminal') await bezahlt(order.id, { provider: d.zahlart, providerRef: `tel-${order.number}`, amountCents: zahl });
    else await haltenBis(hold.id, show.startsAt);
    await audit(u, 'telefonverkauf', 'order', order.id, { number: order.number, zahlart: d.zahlart, plaetze: d.seats.length, summe: order.totalCents });
    revalidatePath('/bestellungen');
    revalidatePath(`/vorstellungen/${d.showId}`);
    fertig = order.id;
  });
  if (fertig) redirect(`/bestellungen/neu?fertig=${fertig}`);
  return e;
}

export async function gutscheinPruefenAktion(code: string): Promise<Ergebnis> {
  return ausfuehren(async () => {
    await assertRole('leitung', 'kassa');
    const v = await gutscheinPruefen(z.string().trim().min(3).max(40).parse(code));
    return { ok: true, meldung: `Gutschein gültig: noch ${formatEur(v.remainingCents)}${v.validUntil ? `, bis ${v.validUntil.toLocaleDateString('de-AT')}` : ''}.`, daten: { rest: v.remainingCents } };
  });
}

// ───────── Aktionen auf der Bestellung ─────────

function neuLaden(orderId: string) {
  revalidatePath(`/bestellungen/${orderId}`);
  revalidatePath('/bestellungen');
}

export async function ticketsSenden(orderId: string, _: Ergebnis): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const u = await assertRole('leitung');
    const r = await ticketMail(orderId);
    if (!r) throw new Error('Keine E-Mail-Adresse hinterlegt');
    if (!r.ok) throw new Error(`Versand fehlgeschlagen: ${'fehler' in r ? r.fehler : ''}`);
    await audit(u, 'tickets_senden', 'order', orderId, { mailId: r.id });
    neuLaden(orderId);
    return { ok: true, meldung: 'demo' in r && r.demo ? 'Tickets erstellt (Demo-Modus: E-Mail nur protokolliert).' : 'Tickets wurden erneut gesendet.' };
  });
}

export async function stornoAktion(orderId: string, _: Ergebnis, fd: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const u = await assertRole('leitung');
    const d = z.object({
      umfang: z.enum(['alle', 'einzeln']),
      methode: z.enum(['zahlungsmittel', 'gutschein', 'keine']),
      grund: z.enum(['kunde', 'kulanz', 'sonstiges']),
      gebuehr: z.string().trim().default('').transform((v) => (v ? parseAmountToCents(v) : 0)).pipe(z.number().int().min(0, 'Gebühr darf nicht negativ sein')),
      notiz: z.string().trim().max(1000).default(''),
      frist: z.literal('ja').optional(),
    }).parse(obj(fd));
    const ticketIds = d.umfang === 'einzeln' ? fd.getAll('ticket').map(String) : undefined;
    if (ticketIds && !ticketIds.length) throw new Error('Bitte mindestens ein Ticket auswählen');
    const o = await db.order.findUniqueOrThrow({ where: { id: orderId }, include: { show: true } });
    const fristIgnorieren = d.frist === 'ja';
    if (fristIgnorieren && !hat(u, 'leitung')) throw new Error('Nur Leitung oder Administration dürfen die 24-Stunden-Frist übergehen');
    if (!fristIgnorieren && !stornoMoeglich(o.show.startsAt)) throw new Error('Die 24-Stunden-Frist ist vorbei. Zum Übergehen bitte das Kästchen „Frist übergehen“ setzen.');
    const r = await stornieren({ orderId, ticketIds, methode: d.methode, grund: d.grund, gebuehrCents: d.gebuehr, notiz: d.notiz, userId: u.id, fristIgnorieren });
    const v = r.voucherId ? await db.voucher.findUnique({ where: { id: r.voucherId } }) : null;
    neuLaden(orderId);
    revalidatePath(`/vorstellungen/${o.showId}`);
    return { ok: true, meldung: `Storniert: ${r.refund.ticketIds.length} Ticket(s), ${formatEur(r.refund.amountCents)}.${v ? ` Gutschein ${v.code} über ${formatEur(v.valueCents)}.` : ''}`, daten: v ? { gutschein: v.code } : undefined };
  });
}

const umbuchungSchema = z.object({
  ticketIds: z.array(z.string()).optional(),
  showId: z.string().min(1, 'Bitte eine neue Vorstellung wählen'),
  seats: plaetzeSchema,
  nachzahlung: z.enum(['bar', 'terminal', 'rechnung']),
  frist: z.boolean().default(false),
});
export type UmbuchungEingabe = z.input<typeof umbuchungSchema>;

export async function umbuchungAktion(orderId: string, eingabe: UmbuchungEingabe): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const u = await assertRole('leitung');
    const d = umbuchungSchema.parse(eingabe);
    const alt = await db.order.findUniqueOrThrow({ where: { id: orderId }, include: { show: true } });
    if (d.frist && !hat(u, 'leitung')) throw new Error('Nur Leitung oder Administration dürfen die 24-Stunden-Frist übergehen');
    if (!d.frist && !stornoMoeglich(alt.show.startsAt)) throw new Error('Die 24-Stunden-Frist ist vorbei. Zum Übergehen bitte das Kästchen „Frist übergehen“ setzen.');
    try {
      const r = await umbuchen({ orderId, ticketIds: d.ticketIds?.length ? d.ticketIds : undefined, showId: d.showId, seats: d.seats, nachzahlung: d.nachzahlung, userId: u.id, fristIgnorieren: d.frist });
      neuLaden(orderId);
      revalidatePath(`/vorstellungen/${alt.showId}`);
      revalidatePath(`/vorstellungen/${d.showId}`);
      const teile = [`Umgebucht auf Bestellung ${r.neu.number}.`];
      if (r.nachzahlung) teile.push(`Nachzahlung ${formatEur(r.nachzahlung)} verbucht.`);
      if (r.restGutschein) teile.push(`Restguthaben ${formatEur(r.restGutschein)} bleibt auf Gutschein ${r.voucherCode}.`);
      return { ok: true, meldung: teile.join(' '), daten: { neu: r.neu.id } };
    } catch (x) {
      if (x instanceof PlatzBelegt) return belegtMeldung(x);
      throw x;
    }
  });
}

export async function zahlungErhalten(orderId: string, _: Ergebnis, fd: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const u = await assertRole('leitung');
    const d = z.object({ provider: z.enum(['bar', 'terminal', 'rechnung']), referenz: z.string().trim().max(120).default('') }).parse(obj(fd));
    const o = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    if (o.status !== 'offen') throw new Error('Die Bestellung ist nicht offen');
    const r = await bezahlt(orderId, { provider: d.provider, providerRef: d.referenz || `manuell-${o.number}`, amountCents: o.totalCents - o.voucherCents });
    if (!r) throw new Error('Die Zahlung war bereits verbucht');
    await audit(u, 'zahlung_erhalten', 'order', orderId, { ...d, betragCents: o.totalCents - o.voucherCents }, { vorher: { status: 'offen' }, nachher: { status: 'bezahlt' } });
    neuLaden(orderId);
    return { ok: true, meldung: 'Zahlung verbucht, Tickets und Rechnung sind erstellt.' };
  });
}

export async function reservierungAufheben(orderId: string, _: Ergebnis): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const u = await assertRole('leitung');
    const o = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    if (o.status !== 'offen') throw new Error('Nur offene Bestellungen können verworfen werden');
    await db.$transaction([
      ...(o.holdId ? [db.hold.deleteMany({ where: { id: o.holdId } })] : []),
      db.order.update({ where: { id: orderId }, data: { status: 'storniert', cancelledAt: new Date(), holdId: null } }),
    ]);
    await audit(u, 'bestellung_verwerfen', 'order', orderId, { holdId: o.holdId }, { vorher: { status: o.status }, nachher: { status: 'storniert' } });
    neuLaden(orderId);
    revalidatePath(`/vorstellungen/${o.showId}`);
    return { ok: true, meldung: 'Bestellung verworfen, Plätze sind wieder frei.' };
  });
}

export async function kundeSpeichern(orderId: string, _: Ergebnis, fd: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const u = await assertRole('leitung');
    const d = kundeSchema.parse({ ...obj(fd), newsletter: fd.get('newsletter') === 'on' });
    if (!d.lastName) throw new Error('Bitte den Nachnamen angeben');
    const o = await db.order.findUniqueOrThrow({ where: { id: orderId }, include: { customer: true } });
    const daten = { ...d, email: d.email.toLowerCase(), phone: d.phone ?? null, company: d.company ?? null, vatId: d.vatId ?? null, street: d.street ?? null, zip: d.zip ?? null, city: d.city ?? null, country: d.country ?? null, newsletter: !!d.newsletter };
    if (o.customer) await db.customer.update({ where: { id: o.customer.id }, data: daten });
    else {
      const c = await db.customer.create({ data: daten });
      await db.order.update({ where: { id: orderId }, data: { customerId: c.id } });
    }
    const diff = aenderung(o.customer, daten);
    await audit(u, o.customer ? 'kunde_bearbeiten' : 'kunde_angelegt', 'order', orderId, { customerId: o.customer?.id, bestellung: o.number }, { vorher: diff.vorher, nachher: diff.nachher });
    if (o.customer) await audit(u, 'kunde_bearbeiten', 'customer', o.customer.id, { ueber: 'bestellung', bestellung: o.number, orderId }, { vorher: diff.vorher, nachher: diff.nachher });
    neuLaden(orderId);
    return { ok: true, meldung: 'Kundendaten gespeichert. Bereits ausgestellte Rechnungen bleiben unverändert.' };
  });
}

export async function notizSpeichern(orderId: string, _: Ergebnis, fd: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const u = await assertRole('leitung');
    const note = z.string().max(4000).parse(String(fd.get('note') ?? ''));
    const alt = await db.order.findUniqueOrThrow({ where: { id: orderId }, select: { note: true } });
    await db.order.update({ where: { id: orderId }, data: { note } });
    await audit(u, 'notiz', 'order', orderId, undefined, { vorher: { note: alt.note }, nachher: { note } });
    neuLaden(orderId);
    return { ok: true, meldung: 'Notiz gespeichert.' };
  });
}

// ───────── Rechnung zur Bestellung ─────────

export async function rechnungSendenAktion(orderId: string, invoiceId: string, _: Ergebnis, fd: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    await assertRole('leitung', 'buchhaltung');
    const an = z.email('Bitte eine gültige E-Mail-Adresse angeben').parse(String(fd.get('an') ?? '').trim());
    const inv = await db.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    if (inv.orderId !== orderId) throw new Error('Die Rechnung gehört nicht zu dieser Bestellung');
    const r = await rechnungSenden(invoiceId, an);
    neuLaden(orderId);
    if (!r.ok) throw new Error(`Versand fehlgeschlagen: ${'fehler' in r ? r.fehler : ''}`);
    return { ok: true, meldung: 'demo' in r && r.demo ? 'Im Demo-Modus nicht verschickt – die Mail steht im E-Mail-Protokoll.' : `Rechnung ${inv.number} an ${an} gesendet.` };
  });
}

/** Für ältere bezahlte Bestellungen ohne Rechnung */
export async function rechnungErstellenAktion(orderId: string, _: Ergebnis): Promise<Ergebnis> {
  return ausfuehren(async () => {
    await assertRole('leitung', 'buchhaltung');
    const o = await db.order.findUniqueOrThrow({ where: { id: orderId }, include: { invoices: true } });
    if (!['bezahlt', 'teilstorniert'].includes(o.status)) throw new Error('Rechnungen gibt es nur für bezahlte Bestellungen');
    if (o.invoices.some((i) => i.kind === 'rechnung')) throw new Error('Für diese Bestellung gibt es bereits eine Rechnung');
    if (o.totalCents === 0) throw new Error('Freikarten (0 €) bekommen keine Rechnung');
    const inv = await db.$transaction((tx) => rechnungFuerBestellung(tx, orderId), { maxWait: 10_000, timeout: 20_000 });
    if (!inv) throw new Error('Für diese Bestellung gibt es bereits eine Rechnung');
    await protokoll({ action: 'rechnung_erstellt', entity: 'invoice', entityId: inv.id, data: { bestellung: o.number, orderId, nachtraeglich: true }, nachher: { number: inv.number, kind: inv.kind, netCents: inv.netCents, vatCents: inv.vatCents, grossCents: inv.grossCents } });
    neuLaden(orderId);
    return { ok: true, meldung: `Rechnung ${inv.number} erstellt.` };
  });
}

// ───────── Schnellaktionen in der Liste ─────────

/** Daten für Bearbeiten/Stornieren aus der Liste (nur lesen) */
export async function bestellungKurz(orderId: string) {
  const u = await assertRole('leitung');
  const o = await db.order.findUniqueOrThrow({ where: { id: orderId }, include: { customer: true, show: { select: { startsAt: true } }, tickets: { where: { status: 'gueltig' }, orderBy: { seatId: 'asc' } } } });
  const c = o.customer;
  return {
    id: o.id, number: o.number, status: o.status, note: o.note,
    kunde: { firstName: c?.firstName ?? '', lastName: c?.lastName ?? '', email: c?.email ?? '', phone: c?.phone ?? '', company: c?.company ?? '', vatId: c?.vatId ?? '', street: c?.street ?? '', zip: c?.zip ?? '', city: c?.city ?? '', country: c?.country ?? '', newsletter: c?.newsletter ?? false },
    tickets: o.tickets.map((t) => ({ id: t.id, label: `${sitzName(t.seatId)} (${KAT_NAME[t.kat]}, ${ART_NAME[t.art] ?? t.art})`, cents: t.priceCents })),
    fristAbgelaufen: !stornoMoeglich(o.show.startsAt),
    darfFrist: hat(u, 'leitung'),
  };
}
export type BestellungKurz = Awaited<ReturnType<typeof bestellungKurz>>;
