// Auswertungen aus dem Journal: Kontensalden, Saldenliste, Kontenblatt, GuV, Bilanz, UVA, Exportdaten.
// Alles vorläufig – Kontenplan und Gliederung sind ein Vorschlag, mit der Steuerberatung abzustimmen.
import { db, getSettings } from '../db';
import { gjBeginn, tag, tagStr, vortag } from './zeitraum';
import { uvaBerechnen, type UvaZeile } from './uva';
import type { BmdEntry } from './bmd';

export type Konto = { id: string; number: string; name: string; type: string; active: boolean; system: boolean; vatCode: string | null };
export const ERFOLG = new Set(['aufwand', 'ertrag']);
export const TYP_NAME: Record<string, string> = { aktiv: 'Aktivkonto', passiv: 'Passivkonto', aufwand: 'Aufwand', ertrag: 'Ertrag' };

async function summen(von: string | null, bis: string) {
  const datum = { ...(von ? { gte: tag(von)! } : {}), lte: tag(bis)! };
  const g = await db.journalLine.groupBy({ by: ['accountId'], where: { entry: { date: datum } }, _sum: { debitCents: true, creditCents: true } });
  return new Map(g.map((x) => [x.accountId, { soll: x._sum.debitCents ?? 0, haben: x._sum.creditCents ?? 0 }]));
}

export type SaldenZeile = Konto & { vortrag: number; soll: number; haben: number; saldo: number };

/**
 * Saldenliste: Vortrag (Bestandskonten: alles vor „von“; Erfolgskonten: ab Beginn des Geschäftsjahres),
 * Soll/Haben im Zeitraum, Saldo = Vortrag + Soll − Haben (positiv = Sollsaldo).
 */
export async function saldenliste(von: string, bis: string, alle = false): Promise<SaldenZeile[]> {
  const s = await getSettings();
  const gj = gjBeginn(von, s.fiscalYearStart);
  const [konten, zeitraum, vorBestand, vorErfolg] = await Promise.all([
    db.account.findMany({ orderBy: { number: 'asc' } }),
    summen(von, bis),
    summen(null, vortag(von)),
    gj < von ? summen(gj, vortag(von)) : Promise.resolve(new Map<string, { soll: number; haben: number }>()),
  ]);
  return konten.map((k) => {
    const v = (ERFOLG.has(k.type) ? vorErfolg : vorBestand).get(k.id);
    const z = zeitraum.get(k.id);
    const vortrag = v ? v.soll - v.haben : 0;
    const soll = z?.soll ?? 0;
    const haben = z?.haben ?? 0;
    return { ...k, vortrag, soll, haben, saldo: vortrag + soll - haben };
  }).filter((k) => alle || k.vortrag || k.soll || k.haben);
}

export async function kontenblatt(nummer: string, von: string, bis: string) {
  const konto = await db.account.findUnique({ where: { number: nummer } });
  if (!konto) return null;
  const s = await getSettings();
  const ab = ERFOLG.has(konto.type) ? gjBeginn(von, s.fiscalYearStart) : null;
  const vor = ab && ab >= von ? null : await db.journalLine.aggregate({ where: { accountId: konto.id, entry: { date: { ...(ab ? { gte: tag(ab)! } : {}), lt: tag(von)! } } }, _sum: { debitCents: true, creditCents: true } });
  const vortrag = vor ? (vor._sum.debitCents ?? 0) - (vor._sum.creditCents ?? 0) : 0;
  const zeilen = await db.journalLine.findMany({
    where: { accountId: konto.id, entry: { date: { gte: tag(von)!, lte: tag(bis)! } } },
    include: { entry: { include: { lines: { include: { account: { select: { number: true } } } } } } },
    orderBy: [{ entry: { date: 'asc' } }, { entry: { number: 'asc' } }],
  });
  let laufend = vortrag;
  return {
    konto, vortrag,
    zeilen: zeilen.map((l) => {
      laufend += l.debitCents - l.creditCents;
      const gegen = [...new Set(l.entry.lines.filter((x) => x.accountId !== konto.id && (l.debitCents ? x.creditCents : x.debitCents)).map((x) => x.account.number))];
      return { id: l.id, entryId: l.entryId, nr: l.entry.number, datum: tagStr(l.entry.date), text: l.text ? `${l.entry.text} – ${l.text}` : l.entry.text, beleg: l.entry.docRef, gegen, soll: l.debitCents, haben: l.creditCents, vatCode: l.vatCode, saldo: laufend };
    }),
  };
}

// ─────────── GuV und Bilanz ───────────

export type Posten = { titel: string; konten: { number: string; name: string; betrag: number }[]; summe: number };

const GUV: { titel: string; art: 'ertrag' | 'aufwand'; passt: (n: string) => boolean }[] = [
  { titel: 'Umsatzerlöse', art: 'ertrag', passt: (n) => /^4[0-4]/.test(n) },
  { titel: 'Sonstige betriebliche Erträge', art: 'ertrag', passt: (n) => /^4[5-9]/.test(n) },
  { titel: 'Materialaufwand und bezogene Leistungen', art: 'aufwand', passt: (n) => n.startsWith('5') },
  { titel: 'Personalaufwand', art: 'aufwand', passt: (n) => n.startsWith('6') },
  { titel: 'Abschreibungen', art: 'aufwand', passt: (n) => /^7[01]/.test(n) },
  { titel: 'Sonstige betriebliche Aufwendungen', art: 'aufwand', passt: (n) => /^7[2-9]/.test(n) },
  { titel: 'Finanzerträge', art: 'ertrag', passt: (n) => n.startsWith('8') },
  { titel: 'Finanzaufwendungen und Steuern', art: 'aufwand', passt: (n) => n.startsWith('8') },
  { titel: 'Übrige Erträge', art: 'ertrag', passt: () => true },
  { titel: 'Übrige Aufwendungen', art: 'aufwand', passt: () => true },
];

export function guvGliedern(zeilen: { number: string; name: string; type: string; soll: number; haben: number }[]) {
  const posten: (Posten & { art: 'ertrag' | 'aufwand' })[] = GUV.map((g) => ({ titel: g.titel, art: g.art, konten: [], summe: 0 }));
  for (const z of zeilen) {
    if (!ERFOLG.has(z.type)) continue;
    const i = GUV.findIndex((g) => g.art === z.type && g.passt(z.number));
    const betrag = z.type === 'ertrag' ? z.haben - z.soll : z.soll - z.haben;
    if (!betrag) continue;
    posten[i].konten.push({ number: z.number, name: z.name, betrag });
    posten[i].summe += betrag;
  }
  const ertraege = posten.filter((p) => p.art === 'ertrag').reduce((s, p) => s + p.summe, 0);
  const aufwand = posten.filter((p) => p.art === 'aufwand').reduce((s, p) => s + p.summe, 0);
  return { posten: posten.filter((p) => p.konten.length), ertraege, aufwand, ergebnis: ertraege - aufwand };
}

export async function erfolgsrechnung(von: string, bis: string) {
  const [konten, z] = await Promise.all([db.account.findMany({ orderBy: { number: 'asc' } }), summen(von, bis)]);
  return guvGliedern(konten.map((k) => ({ ...k, soll: z.get(k.id)?.soll ?? 0, haben: z.get(k.id)?.haben ?? 0 })));
}

const AKTIVA: { titel: string; passt: (n: string) => boolean }[] = [
  { titel: 'Anlagevermögen', passt: (n) => n.startsWith('0') },
  { titel: 'Vorräte', passt: (n) => n.startsWith('1') },
  { titel: 'Forderungen und sonstige Vermögensgegenstände', passt: (n) => /^2[0-6]/.test(n) },
  { titel: 'Kassa, Bank und Geldtransit', passt: (n) => /^2[7-9]/.test(n) },
  { titel: 'Übrige Aktiva', passt: () => true },
];
const PASSIVA: { titel: string; passt: (n: string) => boolean }[] = [
  { titel: 'Eigenkapital', passt: (n) => n.startsWith('9') },
  { titel: 'Rückstellungen', passt: (n) => /^3[01]/.test(n) },
  { titel: 'Erhaltene Anzahlungen und Gutscheine', passt: (n) => /^34[89]/.test(n) },
  { titel: 'Verbindlichkeiten aus Steuern', passt: (n) => /^35/.test(n) },
  { titel: 'Sonstige Verbindlichkeiten', passt: (n) => n.startsWith('3') },
  { titel: 'Übrige Passiva', passt: () => true },
];

/** Bilanz zum Stichtag: Bestandskonten + Ergebnis des laufenden Geschäftsjahres + nicht vorgetragene Vorjahresergebnisse */
export async function bilanz(stichtag: string) {
  const s = await getSettings();
  const gj = gjBeginn(stichtag, s.fiscalYearStart);
  const [konten, alle, lfd] = await Promise.all([db.account.findMany({ orderBy: { number: 'asc' } }), summen(null, stichtag), summen(gj, stichtag)]);
  const aktiva: Posten[] = AKTIVA.map((a) => ({ titel: a.titel, konten: [], summe: 0 }));
  const passiva: Posten[] = PASSIVA.map((a) => ({ titel: a.titel, konten: [], summe: 0 }));
  let ergebnisLfd = 0;
  let ergebnisVor = 0;
  for (const k of konten) {
    const a = alle.get(k.id);
    if (!a) continue;
    if (ERFOLG.has(k.type)) {
      const l = lfd.get(k.id);
      const ges = a.haben - a.soll;
      const jetzt = l ? l.haben - l.soll : 0;
      ergebnisLfd += jetzt;
      ergebnisVor += ges - jetzt;
      continue;
    }
    if (k.type === 'aktiv') {
      const b = a.soll - a.haben;
      if (!b) continue;
      const i = AKTIVA.findIndex((x) => x.passt(k.number));
      aktiva[i].konten.push({ number: k.number, name: k.name, betrag: b });
      aktiva[i].summe += b;
    } else {
      const b = a.haben - a.soll;
      if (!b) continue;
      const i = PASSIVA.findIndex((x) => x.passt(k.number));
      passiva[i].konten.push({ number: k.number, name: k.name, betrag: b });
      passiva[i].summe += b;
    }
  }
  const ek = passiva[0];
  if (ergebnisVor) { ek.konten.push({ number: '', name: 'Ergebnis Vorjahre (noch nicht vorgetragen)', betrag: ergebnisVor }); ek.summe += ergebnisVor; }
  if (ergebnisLfd) { ek.konten.push({ number: '', name: 'Ergebnis laufendes Geschäftsjahr', betrag: ergebnisLfd }); ek.summe += ergebnisLfd; }
  const summeA = aktiva.reduce((x, p) => x + p.summe, 0);
  const summeP = passiva.reduce((x, p) => x + p.summe, 0);
  return { aktiva: aktiva.filter((p) => p.konten.length), passiva: passiva.filter((p) => p.konten.length), summeA, summeP, ergebnisLfd, gjBeginn: gj };
}

// ─────────── UVA ───────────

export async function uvaZeilen(von: string, bis: string) {
  const zeilen = await db.journalLine.findMany({
    where: { entry: { date: { gte: tag(von)!, lte: tag(bis)! } } },
    include: { account: { select: { number: true, name: true } }, entry: { select: { id: true, number: true, date: true, text: true, docRef: true, source: true } } },
    orderBy: [{ entry: { date: 'asc' } }, { entry: { number: 'asc' } }],
  });
  return zeilen;
}

export async function uva(von: string, bis: string) {
  const zeilen = await uvaZeilen(von, bis);
  const u: UvaZeile[] = zeilen.map((l) => ({ entryId: l.entryId, konto: l.account.number, soll: l.debitCents, haben: l.creditCents, vatCode: l.vatCode, base: l.baseCents }));
  return { ergebnis: uvaBerechnen(u), zeilen };
}

// ─────────── Export ───────────

export async function exportBuchungen(von: string, bis: string): Promise<(BmdEntry & { id: string })[]> {
  const e = await db.journalEntry.findMany({
    where: { date: { gte: tag(von)!, lte: tag(bis)! } },
    include: { lines: { include: { account: { select: { number: true, name: true } } } } },
    orderBy: [{ date: 'asc' }, { number: 'asc' }],
  });
  return e.map((x) => ({
    id: x.id, number: x.number, date: tagStr(x.date), docRef: x.docRef, text: x.text, source: x.source,
    lines: x.lines.map((l) => ({ konto: l.account.number, name: l.account.name, soll: l.debitCents, haben: l.creditCents, vatCode: l.vatCode, base: l.baseCents, text: l.text })),
  }));
}
