// Vertriebspartner-API: Anmeldung per API-Schlüssel, Kontingent, Bestellung auf Rechnung, Storno, Webhooks.
import { createHmac } from 'node:crypto';
import { Prisma, type Partner } from '@prisma/client';
import { db } from './db';
import { KEY_RE, schluesselHash } from './apikey';
import { fmtDatumZeit } from './dates';
import { bestellungAnlegen, bezahlt, stornieren } from './orders';
import { htmlToPdf } from './pdf';
import { SITZ, sitzName, type Kat } from './saal';
import { ApiFehler, begrenzen, clientIp, fehlerAntwort } from './schnittstelle';
import { bestellungJson, bestellungLaden, kategorienPruefen } from './shop';
import { qrInhalt, qrSvg } from './tickets';

export const PARTNER_LIMIT = 300; // Anfragen je Minute und Partner

export async function partnerAusAnfrage(req: Request): Promise<Partner> {
  begrenzen(`partner-ip:${clientIp(req)}`, 600);
  const m = (req.headers.get('authorization') ?? '').match(/^Bearer\s+(\S+)$/i);
  if (!m || !KEY_RE.test(m[1])) throw new ApiFehler(401, 'nicht_angemeldet', 'API-Schlüssel fehlt oder hat ein falsches Format (Authorization: Bearer loc_live_…)');
  const p = await db.partner.findUnique({ where: { apiKeyHash: schluesselHash(m[1]) } });
  if (!p || !p.active) throw new ApiFehler(401, 'nicht_angemeldet', 'API-Schlüssel unbekannt oder deaktiviert');
  begrenzen(`partner:${p.id}`, PARTNER_LIMIT);
  if (!p.lastUsedAt || Date.now() - p.lastUsedAt.getTime() > 60e3) await db.partner.update({ where: { id: p.id }, data: { lastUsedAt: new Date() } });
  return p;
}

type Ctx<P> = { params: Promise<P> };
export function partnerRoute<P = Record<string, never>>(handler: (req: Request, partner: Partner, params: P) => Promise<Response>) {
  return async (req: Request, ctx: Ctx<P>) => {
    try {
      const p = await partnerAusAnfrage(req);
      return await handler(req, p, await ctx.params);
    } catch (e) {
      return fehlerAntwort(e);
    }
  };
}

export const partnerKategorien = (p: Partner) => p.categories.filter((k): k is Kat => k === 'I' || k === 'II' || k === 'R');

/** Bereits über diesen Partner verkaufte (nicht stornierte) Tickets je Vorstellung */
export async function verkauftJeShow(partnerId: string, showIds: string[]) {
  const rows = await db.ticket.groupBy({ by: ['showId'], where: { showId: { in: showIds }, status: { not: 'storniert' }, order: { partnerId } }, _count: { _all: true } });
  return new Map(rows.map((r) => [r.showId, r._count._all]));
}

export async function kontingentPruefen(p: Partner, showId: string, neu: number) {
  if (p.quotaPerShow == null) return;
  const schon = (await verkauftJeShow(p.id, [showId])).get(showId) ?? 0;
  if (schon + neu > p.quotaPerShow) throw new ApiFehler(409, 'kontingent_erschoepft', `Kontingent erschöpft: ${p.quotaPerShow - schon} von ${p.quotaPerShow} Tickets für diese Vorstellung verfügbar`, { quota: p.quotaPerShow, verkauft: schon, angefragt: neu });
}

function partnerJson(o: NonNullable<Awaited<ReturnType<typeof bestellungLaden>>>) {
  const { manageToken: _m, ...rest } = bestellungJson(o); // Verwaltungslink ist nur für Endkund:innen
  void _m;
  return rest;
}

export async function partnerBestellungLaden(p: Partner, partnerRef: string) {
  const o = await bestellungLaden({ partnerId: p.id, partnerRef });
  if (!o) throw new ApiFehler(404, 'unbekannt', 'Keine Bestellung mit dieser partnerRef');
  return o;
}

/**
 * Bestellung auf Rechnung des Partners: sofort bezahlt (provider "partner"), Provision laut Vertrag.
 * Idempotent über partnerRef: dieselbe Referenz liefert die bestehende Bestellung.
 */
export async function partnerBestellen(p: Partner, e: { holdToken: string; partnerRef: string; kunde?: { name: string; email: string } }) {
  const vorhanden = await bestellungLaden({ partnerId: p.id, partnerRef: e.partnerRef });
  if (vorhanden) return { neu: false, order: partnerJson(vorhanden) };
  const hold = await db.hold.findUnique({ where: { token: e.holdToken } });
  if (!hold || hold.expiresAt < new Date()) throw new ApiFehler(410, 'reservierung_abgelaufen', 'Die Reservierung ist abgelaufen');
  const seats = hold.seats as { seatId: string; art: string }[];
  kategorienPruefen(seats.map((s) => s.seatId), partnerKategorien(p));
  await kontingentPruefen(p, hold.showId, seats.length);
  const offen = await db.order.findFirst({ where: { holdId: hold.id, status: 'offen' } });
  if (offen) throw new ApiFehler(409, 'reservierung_in_verwendung', 'Diese Reservierung wird bereits für eine andere Bestellung verwendet');
  const [vor, ...nach] = (e.kunde?.name ?? '').trim().split(/\s+/);
  let o;
  try {
    o = await bestellungAnlegen({
      holdToken: e.holdToken, channel: 'partner', partnerId: p.id, partnerRef: e.partnerRef, note: `Partner ${p.name}`,
      kunde: e.kunde ? { firstName: nach.length ? vor : '', lastName: nach.length ? nach.join(' ') : vor, email: e.kunde.email } : undefined,
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const o2 = await bestellungLaden({ partnerId: p.id, partnerRef: e.partnerRef });
      if (o2) return { neu: false, order: partnerJson(o2) };
    }
    throw err;
  }
  const provision = Math.round((o.totalCents * p.commissionPct) / 100);
  if (!(await bezahlt(o.id, { provider: 'partner', providerRef: e.partnerRef, amountCents: o.totalCents, commissionCents: provision }))) {
    await db.order.update({ where: { id: o.id }, data: { status: 'storniert', cancelledAt: new Date(), partnerRef: null, note: `Plätze vergeben – Partner-Ref. ${e.partnerRef} nicht ausgeführt` } });
    throw new ApiFehler(409, 'plaetze_vergeben', 'Die Plätze waren nicht mehr frei – bitte neu reservieren');
  }
  return { neu: true, order: partnerJson((await bestellungLaden({ id: o.id }))!) };
}

/**
 * Storno durch den Partner (24-h-Frist gilt). Buchhalterisch über "zahlungsmittel" mit Anbieter "partner":
 * Es fließt kein Geld zurück (erstatten() wird für "partner" übersprungen), die Forderung an den Partner
 * (2010) sinkt um den Ticketpreis – der Partner verrechnet das mit der nächsten Abrechnung und erstattet
 * seinen Kund:innen selbst. Die Provision (7660) wird nicht automatisch korrigiert.
 */
export async function partnerStornieren(p: Partner, partnerRef: string, ticketCodes?: string[]) {
  const o = await partnerBestellungLaden(p, partnerRef);
  let ticketIds: string[] | undefined;
  if (ticketCodes?.length) {
    const unbekannt = ticketCodes.filter((c) => !o.tickets.some((t) => t.code === c));
    if (unbekannt.length) throw new ApiFehler(400, 'unbekanntes_ticket', `Unbekannte Ticketcodes: ${unbekannt.join(', ')}`);
    ticketIds = o.tickets.filter((t) => ticketCodes.includes(t.code)).map((t) => t.id);
  }
  await stornieren({ orderId: o.id, ticketIds, methode: 'zahlungsmittel', grund: 'partner', notiz: `Storno über Partner-API (${p.name})`, mail: false });
  return partnerJson((await bestellungLaden({ id: o.id }))!);
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Einfache Ticket-PDF (ein Ticket je Abschnitt, QR-Code als SVG) über Gotenberg */
export async function ticketsPdf(orderId: string) {
  const o = await db.order.findUniqueOrThrow({ where: { id: orderId }, include: { tickets: { where: { status: { not: 'storniert' } }, orderBy: { seatId: 'asc' } }, show: true, customer: true } });
  const bloecke = await Promise.all(o.tickets.map(async (t) => `
    <section class="t">
      <div class="qr">${await qrSvg(qrInhalt(t.code, t.showId))}</div>
      <div>
        <p class="k">Light of Creation · Votivkirche Wien</p>
        <h2>${esc(fmtDatumZeit(o.show.startsAt))} Uhr</h2>
        <p class="s">${esc(sitzName(t.seatId))}</p>
        <p>${t.kat === 'R' ? 'Rollstuhlplatz inkl. Begleitperson' : `Kategorie ${t.kat} · ${t.art === 'ermaessigt' ? 'ermäßigt' : 'Vollpreis'}`}</p>
        <p class="c">${t.code}</p>
        <p class="m">Buchung ${esc(o.number)}${o.partnerRef ? ` · Ref. ${esc(o.partnerRef)}` : ''}${o.customer ? ` · ${esc(`${o.customer.firstName} ${o.customer.lastName}`.trim())}` : ''}</p>
      </div>
    </section>`));
  const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Tickets ${esc(o.number)}</title><style>
    @page { size: A4; margin: 14mm; }
    body { font-family: Helvetica, Arial, sans-serif; color: #121a2b; margin: 0; }
    .t { display: flex; gap: 8mm; align-items: center; border: 1px solid #c9bfa8; border-radius: 4mm; padding: 6mm; margin-bottom: 6mm; page-break-inside: avoid; }
    .qr svg { width: 45mm; height: 45mm; display: block; }
    h2 { margin: 1mm 0; font-size: 18pt; } p { margin: 1mm 0; font-size: 11pt; }
    .k { font-size: 9pt; letter-spacing: .08em; text-transform: uppercase; color: #6e5118; }
    .s { font-weight: bold; font-size: 13pt; } .c { font-family: monospace; font-size: 13pt; letter-spacing: .1em; } .m { color: #59617a; font-size: 9pt; }
  </style></head><body>${bloecke.join('')}<p class="m">Bitte den QR-Code beim Einlass zeigen. Einlass ab 30 Minuten vor Beginn. Die Show verwendet Stroboskop- und Blitzlichteffekte.</p></body></html>`;
  return htmlToPdf(html);
}

// ───────── Webhooks ─────────

export const signatur = (geheimnis: string, body: string) => `sha256=${createHmac('sha256', geheimnis).update(body).digest('hex')}`;

/** Webhook senden (bis zu 3 Versuche), Ergebnis landet im Protokoll. Wirft nie. */
export async function webhookSenden(p: Pick<Partner, 'id' | 'name' | 'webhookUrl' | 'webhookSecret'>, event: string, data: unknown) {
  if (!p.webhookUrl) return { ok: false, status: 0, fehler: 'Keine Webhook-URL' };
  const body = JSON.stringify({ event, createdAt: new Date().toISOString(), data });
  let letzte = { ok: false, status: 0, fehler: '' };
  for (let versuch = 1; versuch <= 3; versuch++) {
    try {
      const r = await fetch(p.webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'Lightback-Webhook/1', 'X-LoC-Event': event, 'X-LoC-Signature': signatur(p.webhookSecret, body) }, body, signal: AbortSignal.timeout(10_000) });
      letzte = { ok: r.ok, status: r.status, fehler: r.ok ? '' : `HTTP ${r.status}` };
      if (r.ok) break;
    } catch (e) {
      letzte = { ok: false, status: 0, fehler: (e as Error).message };
    }
    if (versuch < 3) await new Promise((res) => setTimeout(res, versuch * 2000));
  }
  await db.auditLog.create({ data: { action: letzte.ok ? 'webhook_ok' : 'webhook_fehler', entity: 'partner', entityId: p.id, data: { event, url: p.webhookUrl, status: letzte.status, fehler: letzte.fehler || undefined } } }).catch(() => {});
  if (!letzte.ok) console.error(`Webhook ${event} an ${p.name} fehlgeschlagen: ${letzte.fehler}`);
  return letzte;
}

/** Nach Absage einer Vorstellung: betroffene Partner informieren */
export async function absageMelden(showId: string, grund: string) {
  const show = await db.show.findUnique({ where: { id: showId } });
  if (!show) return;
  const orders = await db.order.findMany({ where: { showId, partnerId: { not: null } }, include: { tickets: true, partner: true } });
  const jePartner = new Map<string, typeof orders>();
  for (const o of orders) jePartner.set(o.partnerId!, [...(jePartner.get(o.partnerId!) ?? []), o]);
  await Promise.all([...jePartner.values()].map((os) => {
    const p = os[0].partner!;
    return webhookSenden(p, 'show.cancelled', {
      showId, startsAt: show.startsAt.toISOString(), reason: grund,
      orders: os.map((o) => ({ partnerRef: o.partnerRef, number: o.number, status: o.status, tickets: o.tickets.map((t) => ({ code: t.code, seatId: t.seatId, status: t.status })) })),
    });
  }));
}

export const katName = (k: string) => (k === 'R' ? 'Rollstuhl' : `Kat. ${k}`);
export const sitzKat = (id: string) => SITZ[id]?.kat;
