// Gästeliste einer Vorstellung: Freikarten (0 €) für Presse, Sponsoren, Team …
// Technisch eine Bestellung mit Kanal „gast“, sofort „bezahlt“ (0 €) – ohne Zahlung, Rechnung und Buchung.
// Zustellung per E-Mail (Ticket mit QR) und/oder an der Kassa hinterlegt (Abholung wird in Order.meta vermerkt).
import { protokoll } from './audit';
import type { Nutzer } from './auth';
import { db } from './db';
import { bestePlaetze } from './kassa';
import { bestellungAnlegen, bezahlt, stornieren, ticketMail } from './orders';
import { SITZ, sitzName, type Kat } from './saal';
import { freigeben, PlatzBelegt, reservieren } from './seats';

export const GAST_GRUENDE = ['Presse', 'Sponsor', 'Kooperation', 'Künstler:in/Team', 'Influencer', 'Gewinnspiel', 'Kulanz', 'Sonstiges'] as const;
export type GastGrund = (typeof GAST_GRUENDE)[number];
export const GAST_MAX = 20;

export type GastMeta = { grund: string; notiz?: string; mail: boolean; hinterlegt: boolean; begleitung: boolean; abgeholtAm?: string; abgeholtVon?: string };

/** Gast-Angaben aus Order.meta (null = keine Gästeliste) */
export function gastMeta(meta: unknown): GastMeta | null {
  const g = meta && typeof meta === 'object' ? (meta as { gast?: GastMeta }).gast : undefined;
  return g && typeof g === 'object' ? g : null;
}

/** „Erika Muster“ → Vorname „Erika“, Nachname „Muster“; ein Wort = Nachname */
export function nameTeilen(name: string) {
  const teile = name.trim().replace(/\s+/g, ' ').split(' ');
  const lastName = teile.pop() ?? '';
  return { firstName: teile.join(' '), lastName };
}

export async function freikartenStand(showId: string) {
  const [show, vergeben] = await Promise.all([
    db.show.findUniqueOrThrow({ where: { id: showId }, select: { freikartenLimit: true } }),
    db.ticket.count({ where: { showId, art: 'frei', status: { not: 'storniert' } } }),
  ]);
  return { limit: show.freikartenLimit, vergeben, rest: show.freikartenLimit == null ? null : show.freikartenLimit - vergeben };
}

export type GastEingabe = {
  showId: string; name: string; email?: string; phone?: string; company?: string;
  anzahl: number; kat?: Kat; seats?: string[];
  grund: GastGrund; notiz?: string; mail: boolean; hinterlegt: boolean; begleitung: boolean;
};

/** Gast anlegen: Plätze (gewählt oder beste freie), Bestellung, 0-€-Zahlung, Zustellung. */
export async function gastAnlegen(p: GastEingabe, user: Nutzer) {
  const show = await db.show.findUniqueOrThrow({ where: { id: p.showId } });
  if (show.status === 'abgesagt') throw new Error('Die Vorstellung ist abgesagt.');
  if (p.mail && !p.email) throw new Error(`${p.name}: Für den Versand per E-Mail fehlt die E-Mail-Adresse.`);
  if (!p.mail && !p.hinterlegt) throw new Error('Bitte wählen Sie, wie die Karten zugestellt werden (E-Mail und/oder Kassa).');
  if (!p.name.trim()) throw new Error('Bitte den Namen angeben.');

  // Rollstuhlplatz-Tickets enthalten den Begleitsitz schon; +1 gibt es nur in Kat. I/II
  const kat = p.kat ?? 'I';
  const begleitung = p.begleitung && !p.seats?.length && kat !== 'R';
  const anzahl = p.seats?.length ? p.seats.length : p.anzahl + (begleitung ? 1 : 0);
  if (anzahl < 1 || anzahl > GAST_MAX + 1) throw new Error(`1 bis ${GAST_MAX} Freikarten je Gast`);
  const stand = await freikartenStand(p.showId);

  let hold = null;
  for (let versuch = 0; versuch < 3 && !hold; versuch++) {
    const plaetze = p.seats?.length
      ? p.seats.map((seatId) => ({ seatId, art: 'frei' }))
      : await bestePlaetze(p.showId, [{ kat, art: 'frei', anzahl }]);
    try {
      hold = await reservieren(p.showId, plaetze, { gast: true, max: GAST_MAX + 1 });
    } catch (e) {
      if (!(e instanceof PlatzBelegt) || p.seats?.length) throw e;
    }
  }
  if (!hold) throw new Error('Die Plätze wurden gerade anderweitig vergeben – bitte erneut versuchen.');

  const { firstName, lastName } = nameTeilen(p.name);
  let order;
  try {
    order = await bestellungAnlegen({
      holdToken: hold.token, channel: 'gast', createdById: user.id, note: p.notiz ?? '',
      kunde: { firstName, lastName, email: p.email ?? '', phone: p.phone || undefined, company: p.company || undefined },
    });
  } catch (e) {
    await freigeben(hold.token);
    throw e;
  }
  const meta: GastMeta = { grund: p.grund, notiz: p.notiz || undefined, mail: p.mail, hinterlegt: p.hinterlegt, begleitung };
  await db.order.update({ where: { id: order.id }, data: { meta: { gast: meta } } });
  // 0 €: keine Zahlung, keine Rechnung, keine Buchung (siehe orders.bezahlt / rechnungFuerBestellung)
  const fertig = await bezahlt(order.id, { provider: 'gast', providerRef: `gast-${order.number}`, amountCents: 0, ohneMail: true });
  if (!fertig) throw new Error('Die Plätze waren nicht mehr frei – bitte erneut versuchen.');
  const mail = p.mail ? await ticketMail(order.id, { vorlage: 'freikarte' }) : null;
  const ueber = stand.limit != null && stand.vergeben + anzahl > stand.limit ? stand.vergeben + anzahl - stand.limit : 0;
  await protokoll({
    user, action: 'gast_angelegt', entity: 'order', entityId: order.id,
    data: { showId: p.showId, bestellung: order.number, plaetze: (hold.seats as { seatId: string }[]).map((s) => sitzName(s.seatId)), mailId: mail?.id, kontingentUeberschritten: ueber || undefined },
    nachher: { name: p.name, email: p.email || undefined, company: p.company || undefined, anzahl, ...meta },
  });
  return { order, anzahl, mail, warnung: ueber ? `Achtung: Das Freikarten-Kontingent (${stand.limit}) ist um ${ueber} überschritten.` : '' };
}

/** Hinterlegte Karten an der Kassa ausgeben (Abholung vermerken). Wiederholte Ausgabe = Nachdruck. */
export async function gastAusgeben(orderId: string, user: Nutzer) {
  const o = await db.order.findUniqueOrThrow({ where: { id: orderId }, include: { customer: true } });
  const g = gastMeta(o.meta);
  if (!g) throw new Error('Diese Bestellung steht nicht auf der Gästeliste.');
  if (!['bezahlt', 'teilstorniert'].includes(o.status)) throw new Error('Die Freikarten sind storniert.');
  if (g.abgeholtAm) {
    await protokoll({ user, action: 'gast_nachdruck', entity: 'order', entityId: orderId, data: { bestellung: o.number, abgeholtAm: g.abgeholtAm } });
    return { nachdruck: true };
  }
  const neu: GastMeta = { ...g, abgeholtAm: new Date().toISOString(), abgeholtVon: user.name };
  await db.order.update({ where: { id: orderId }, data: { meta: { ...(o.meta as object), gast: neu } } });
  await protokoll({ user, action: 'gast_ausgegeben', entity: 'order', entityId: orderId, data: { bestellung: o.number }, vorher: { abgeholtAm: null }, nachher: { abgeholtAm: neu.abgeholtAm, abgeholtVon: neu.abgeholtVon } });
  return { nachdruck: false };
}

/** Freikarten zurückziehen (0 €: keine Erstattung, keine Buchung) */
export async function gastStornieren(orderId: string, grund: string, user: Nutzer) {
  const o = await db.order.findUniqueOrThrow({ where: { id: orderId } });
  if (!gastMeta(o.meta)) throw new Error('Diese Bestellung steht nicht auf der Gästeliste.');
  return stornieren({ orderId, methode: 'keine', grund: 'sonstiges', notiz: `Gästeliste: ${grund}`, userId: user.id, mail: false, fristIgnorieren: true });
}

/** Gästeliste einer Vorstellung, nach Nachname sortiert */
export async function gaesteListe(showId: string, mitStorniert = false) {
  const orders = await db.order.findMany({
    where: { showId, channel: 'gast', ...(mitStorniert ? {} : { status: { in: ['bezahlt', 'teilstorniert'] } }) },
    include: { customer: true, tickets: { orderBy: { seatId: 'asc' } } },
  });
  return orders
    .map((o) => ({ ...o, gast: gastMeta(o.meta)!, aktiv: o.tickets.filter((t) => t.status !== 'storniert').sort((a, b) => (SITZ[a.seatId]?.reihe ?? 0) - (SITZ[b.seatId]?.reihe ?? 0) || (SITZ[a.seatId]?.platz ?? 0) - (SITZ[b.seatId]?.platz ?? 0)) }))
    .sort((a, b) => `${a.customer?.lastName ?? ''} ${a.customer?.firstName ?? ''}`.localeCompare(`${b.customer?.lastName ?? ''} ${b.customer?.firstName ?? ''}`, 'de'));
}

/** Zeilen „Name;E-Mail;Anzahl;Grund“ (auch Tab oder Komma als Trenner, Kopfzeile wird übersprungen) */
export function gaesteZeilen(text: string) {
  const zeilen: { zeile: number; name: string; email: string; anzahl: number; grund: GastGrund; notiz: string; fehler?: string }[] = [];
  text.split(/\r?\n/).forEach((roh, i) => {
    const z = roh.trim();
    if (!z) return;
    const trenner = z.includes(';') ? ';' : z.includes('\t') ? '\t' : ',';
    const [name = '', email = '', anzahl = '1', grund = ''] = z.split(trenner).map((x) => x.trim().replace(/^"|"$/g, ''));
    if (i === 0 && /^name$/i.test(name)) return;
    const n = Number.parseInt(anzahl || '1', 10);
    const g = GAST_GRUENDE.find((x) => x.toLowerCase() === grund.toLowerCase() || x.toLowerCase().startsWith(grund.toLowerCase().slice(0, 5)) && grund.length >= 4);
    const e = { zeile: i + 1, name: name.slice(0, 120), email: email.toLowerCase().slice(0, 200), anzahl: n, grund: g ?? 'Sonstiges', notiz: g || !grund ? '' : grund.slice(0, 200) } as (typeof zeilen)[number];
    if (!name) e.fehler = 'Name fehlt';
    else if (!Number.isInteger(n) || n < 1 || n > GAST_MAX) e.fehler = `Anzahl 1 bis ${GAST_MAX}`;
    else if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) e.fehler = 'E-Mail-Adresse ungültig';
    zeilen.push(e);
  });
  return zeilen;
}

/** Sammelimport: jede Zeile ein Gast. Fehler einer Zeile brechen den Rest nicht ab. */
export async function gaesteImportieren(showId: string, text: string, vorgabe: { kat: Kat; mail: boolean; hinterlegt: boolean }, user: Nutzer) {
  const zeilen = gaesteZeilen(text);
  if (!zeilen.length) throw new Error('Keine Zeilen gefunden. Format: Name;E-Mail;Anzahl;Grund');
  if (zeilen.length > 200) throw new Error('Höchstens 200 Zeilen auf einmal.');
  const ergebnis: { zeile: number; name: string; ok: boolean; text: string }[] = [];
  let warnung = '';
  for (const z of zeilen) {
    if (z.fehler) { ergebnis.push({ zeile: z.zeile, name: z.name, ok: false, text: z.fehler }); continue; }
    try {
      const mail = vorgabe.mail && !!z.email;
      const r = await gastAnlegen({ showId, name: z.name, email: z.email || undefined, anzahl: z.anzahl, kat: vorgabe.kat, grund: z.grund, notiz: z.notiz, mail, hinterlegt: vorgabe.hinterlegt || !mail, begleitung: false }, user);
      if (r.warnung) warnung = r.warnung;
      ergebnis.push({ zeile: z.zeile, name: z.name, ok: true, text: `${r.anzahl} Karte(n), ${r.order.number}${mail ? ', E-Mail' : ''}` });
    } catch (e) {
      ergebnis.push({ zeile: z.zeile, name: z.name, ok: false, text: (e as Error).message });
    }
  }
  await protokoll({ user, action: 'gaeste_import', entity: 'show', entityId: showId, data: { zeilen: zeilen.length, ok: ergebnis.filter((e) => e.ok).length, fehler: ergebnis.filter((e) => !e.ok).map((e) => `${e.zeile}: ${e.text}`) } });
  return { ergebnis, warnung };
}

/** Freikarten je Grund (für Vorstellungsseite und Statistik) */
export function nachGrund(orders: { meta: unknown; tickets: { status: string; art: string }[] }[]) {
  const m = new Map<string, number>();
  for (const o of orders) {
    const g = gastMeta(o.meta)?.grund ?? 'ohne Gästeliste';
    const n = o.tickets.filter((t) => t.status !== 'storniert' && t.art === 'frei').length;
    if (n) m.set(g, (m.get(g) ?? 0) + n);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

export const istSitz = (id: string) => !!SITZ[id];
