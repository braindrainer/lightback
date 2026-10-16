// „Buchung verwalten“ im Shop: Buchung über Nummer + E-Mail finden, selbst umbuchen.
// Storno läuft über orders.stornieren, die Frist (STORNO_FRIST_H) gilt für beides.
import { bestePlaetze, freierRollstuhlplatz } from './bestplatz';
import { db } from './db';
import { stornoMoeglich, STORNO_FRIST_H } from './orders';
import { preis, SITZ, type Kat, type Preise } from './saal';
import { ApiFehler } from './schnittstelle';
import { platzStatus, PlatzBelegt } from './seats';
import { umbuchen } from './umbuchung';

const AKTEUR = 'Webshop (Kund:in)';

/** Buchungsnummer (LOC-…) oder Ticketcode, dazu die E-Mail der Buchung → manageToken */
export async function buchungFinden(nummer: string, email: string) {
  const n = nummer.trim().toUpperCase().replace(/\s+/g, '');
  const mail = email.trim().toLowerCase();
  const o = (await db.order.findFirst({ where: { number: { equals: n, mode: 'insensitive' } }, select: { manageToken: true, status: true, channel: true, customer: { select: { email: true } } } }))
    ?? (await db.ticket.findFirst({ where: { code: { equals: n, mode: 'insensitive' } }, select: { order: { select: { manageToken: true, status: true, channel: true, customer: { select: { email: true } } } } } }))?.order;
  // Gleiche Antwort für „unbekannt“ und „E-Mail passt nicht“
  if (!o || !o.customer || o.customer.email.toLowerCase() !== mail || !['bezahlt', 'teilstorniert', 'storniert'].includes(o.status)) {
    throw new ApiFehler(404, 'nicht_gefunden', 'Wir haben keine Buchung mit dieser Nummer und E-Mail-Adresse gefunden.');
  }
  return o.manageToken;
}

/** Freie Plätze für die Tickets suchen, je Kategorie nebeneinander */
function plaetzeSuchen(tickets: { kat: string; art: string }[], belegt: Set<string>) {
  const erg: { seatId: string; art: string }[] = [];
  const gruppen = new Map<string, { kat: string; art: string }[]>();
  for (const t of tickets) gruppen.set(t.kat, [...(gruppen.get(t.kat) ?? []), t]);
  for (const [kat, liste] of gruppen) {
    if (kat === 'R') {
      for (const t of liste) {
        const r = freierRollstuhlplatz(belegt);
        if (!r) return null;
        belegt.add(r).add(`0-${2 * SITZ[r].stellplatz! - 1}`).add(`0-${2 * SITZ[r].stellplatz!}`);
        erg.push({ seatId: r, art: t.art });
      }
      continue;
    }
    const ids = bestePlaetze(liste.length, kat as Exclude<Kat, 'R'>, belegt);
    if (!ids) return null;
    ids.forEach((id, i) => { belegt.add(id); erg.push({ seatId: id, art: liste[i].art }); });
  }
  return erg;
}

/**
 * Umbuchung durch die Kund:innen auf eine andere Vorstellung, gleiche Kategorie und Tarif.
 * Nur ohne Aufpreis; ist die neue Vorstellung günstiger, bleibt die Differenz als Gutschein.
 */
export async function selbstUmbuchen(manageToken: string, p: { showId: string; ticketCodes?: string[] }) {
  const o = await db.order.findUnique({ where: { manageToken }, include: { tickets: true, show: true } });
  if (!o) throw new ApiFehler(404, 'unbekannt', 'Buchung nicht gefunden');
  if (o.channel === 'partner') throw new ApiFehler(403, 'ueber_partner', 'Diese Buchung wurde über einen Vertriebspartner gekauft. Bitte wenden Sie sich an ihn.');
  if (!['bezahlt', 'teilstorniert'].includes(o.status)) throw new ApiFehler(422, 'nicht_moeglich', 'Diese Buchung kann nicht mehr geändert werden.');
  if (!stornoMoeglich(o.show.startsAt)) throw new ApiFehler(422, 'frist', `Umbuchen ist nur bis ${STORNO_FRIST_H} Stunden vor Beginn möglich.`);
  const tickets = o.tickets.filter((t) => t.status === 'gueltig' && (!p.ticketCodes?.length || p.ticketCodes.includes(t.code)));
  if (!tickets.length || (p.ticketCodes?.length && tickets.length !== p.ticketCodes.length)) throw new ApiFehler(400, 'unbekanntes_ticket', 'Bitte wählen Sie gültige Tickets dieser Buchung.');
  if (p.showId === o.showId) throw new ApiFehler(400, 'gleiche_vorstellung', 'Bitte wählen Sie eine andere Vorstellung.');
  const show = await db.show.findUnique({ where: { id: p.showId } });
  if (!show || show.status !== 'verkauf' || show.startsAt <= new Date()) throw new ApiFehler(409, 'kein_verkauf', 'Für diese Vorstellung ist keine Buchung möglich.');

  const neuSumme = tickets.reduce((s, t) => s + preis(show.prices as Preise, t.kat as Kat, t.art), 0);
  const altSumme = tickets.reduce((s, t) => s + t.priceCents, 0);
  if (neuSumme > altSumme) throw new ApiFehler(409, 'aufpreis', 'Diese Vorstellung kostet mehr als Ihre Tickets. Bitte schreiben Sie uns, wir buchen gerne für Sie um.');

  for (let versuch = 0; versuch < 3; versuch++) {
    const st = await platzStatus(show.id);
    const seats = plaetzeSuchen(tickets, new Set(Object.entries(st).filter(([, s]) => s !== 'frei').map(([id]) => id)));
    if (!seats) throw new ApiFehler(409, 'keine_plaetze', 'In dieser Vorstellung gibt es in Ihrer Kategorie nicht genug freie Plätze nebeneinander.');
    try {
      const r = await umbuchen({ orderId: o.id, ticketIds: p.ticketCodes?.length ? tickets.map((t) => t.id) : undefined, showId: show.id, seats, nachzahlung: 'rechnung', channel: 'web', akteur: AKTEUR });
      return { manageToken: r.neu.manageToken, number: r.neu.number, gutschein: r.restGutschein > 0 ? { code: r.voucherCode, restCents: r.restGutschein } : null };
    } catch (e) {
      if (!(e instanceof PlatzBelegt)) throw e;
    }
  }
  throw new ApiFehler(409, 'keine_plaetze', 'Die Plätze wurden gerade vergeben – bitte erneut versuchen.');
}
