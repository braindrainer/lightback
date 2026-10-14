'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { assertRole } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { db } from '@/lib/db';
import { ausfuehren, pruefen, type Ergebnis } from '@/lib/finanzen/aktion';
import { bankZuordnen, belegBezahlt, belegStornieren, buchungStornieren, festschreiben, manuellBuchen, uvaBuchen } from '@/lib/finanzen/buchhaltung';
import { euroZuCent, fmtTagStr, tag } from '@/lib/finanzen/zeitraum';
import { STEUERCODES, vorstellungenAbrechnen } from '@/lib/ledger';
import { formatEur } from '@/lib/money';

const datum = z.string().refine((s) => !!tag(s), 'Bitte ein gültiges Datum angeben.');
const steuercode = z.string().optional().transform((s) => (s && s in STEUERCODES ? s : null));
const neu = () => revalidatePath('/buchhaltung', 'layout');

const zeileSchema = z.object({
  konto: z.string().transform((s) => s.trim().match(/^\d+/)?.[0] ?? '').refine((s) => !!s, 'Jede Zeile braucht ein Konto.'),
  soll: z.string().transform((s) => euroZuCent(s) ?? 0),
  haben: z.string().transform((s) => euroZuCent(s) ?? 0),
  vatCode: z.string().nullable().optional().transform((s) => (s && s in STEUERCODES ? s : null)),
  brutto: z.boolean().optional().default(true),
}).refine((z) => (z.soll > 0) !== (z.haben > 0) && z.soll >= 0 && z.haben >= 0, 'Jede Zeile hat entweder einen Soll- oder einen Haben-Betrag (positiv).');

export async function buchenAktion(_: Ergebnis, fd: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const u = await assertRole('buchhaltung');
    const k = pruefen(z.object({ datum, text: z.string().trim().min(2, 'Buchungstext fehlt.').max(200), beleg: z.string().trim().max(60).optional().default('') }), fd);
    let roh: unknown;
    try { roh = JSON.parse(String(fd.get('zeilen') ?? '[]')); } catch { throw new Error('Zeilen nicht lesbar'); }
    const r = z.array(zeileSchema).min(2, 'Eine Buchung braucht mindestens zwei Zeilen.').max(40).safeParse(roh);
    if (!r.success) throw new Error(r.error.issues[0].message);
    const soll = r.data.reduce((s, x) => s + x.soll, 0);
    const haben = r.data.reduce((s, x) => s + x.haben, 0);
    if (soll !== haben) throw new Error(`Die Buchung ist nicht ausgeglichen: Soll ${formatEur(soll)}, Haben ${formatEur(haben)}.`);
    const e = await manuellBuchen({ datum: tag(k.datum)!, text: k.text, beleg: k.beleg, zeilen: r.data }, u.id);
    neu();
    return `Buchung Nr. ${e.number} gespeichert.`;
  });
}

export async function stornoBuchungAktion(entryId: string, _: Ergebnis, fd: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const u = await assertRole('buchhaltung');
    const d = pruefen(z.object({ datum }), fd);
    const e = await buchungStornieren(entryId, tag(d.datum)!, u.id);
    neu();
    return `Storniert mit Buchung Nr. ${e?.number}.`;
  });
}

export async function kontoAnlegenAktion(_: Ergebnis, fd: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const u = await assertRole('buchhaltung');
    const d = pruefen(z.object({
      number: z.string().trim().regex(/^\d{4,5}$/, 'Kontonummer: 4 oder 5 Ziffern.'),
      name: z.string().trim().min(2, 'Kontobezeichnung fehlt.').max(80),
      type: z.enum(['aktiv', 'passiv', 'aufwand', 'ertrag'], 'Bitte die Kontoart wählen.'),
      vatCode: steuercode,
    }), fd);
    if (await db.account.findUnique({ where: { number: d.number } })) throw new Error(`Konto ${d.number} gibt es schon.`);
    const k = await db.account.create({ data: { number: d.number, name: d.name, type: d.type, vatCode: d.vatCode } });
    await audit(u, 'konto.anlegen', 'account', k.id, undefined, { nachher: d });
    neu();
    return `Konto ${d.number} angelegt.`;
  });
}

export async function kontoAktivAktion(id: string, aktiv: boolean, _: Ergebnis): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const u = await assertRole('buchhaltung');
    const k = await db.account.findUniqueOrThrow({ where: { id } });
    if (k.system) throw new Error('Systemkonten werden von Automatikbuchungen verwendet und bleiben aktiv.');
    await db.account.update({ where: { id }, data: { active: aktiv } });
    await audit(u, aktiv ? 'konto.aktivieren' : 'konto.deaktivieren', 'account', id, { number: k.number }, { vorher: { active: k.active }, nachher: { active: aktiv } });
    neu();
    return aktiv ? 'Konto aktiviert.' : 'Konto deaktiviert.';
  });
}

export async function uvaBuchenAktion(monat: string, _: Ergebnis): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const u = await assertRole('buchhaltung');
    if (!/^\d{4}-\d{2}$/.test(monat)) throw new Error('Monat ungültig');
    const e = await uvaBuchen(monat, u.id);
    neu();
    return `UVA ${monat} gebucht (Buchung Nr. ${e?.number}).`;
  });
}

export async function belegBezahltAktion(id: string, _: Ergebnis, fd: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const u = await assertRole('buchhaltung');
    const d = pruefen(z.object({ datum }), fd);
    await belegBezahlt(id, tag(d.datum)!, u.id);
    await audit(u, 'beleg.bezahlt', 'expense', id, d);
    neu();
    return 'Zahlung gebucht.';
  });
}

export async function belegStornoAktion(id: string, _: Ergebnis, fd: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const u = await assertRole('buchhaltung');
    const d = pruefen(z.object({ datum }), fd);
    await belegStornieren(id, tag(d.datum)!, u.id);
    await audit(u, 'beleg.storno', 'expense', id, d);
    neu();
    return 'Beleg storniert.';
  });
}

export async function bankZuordnenAktion(txId: string, _: Ergebnis, fd: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const u = await assertRole('buchhaltung');
    const art = String(fd.get('art') ?? '');
    const ziel = String(fd.get('ziel') ?? '');
    if (art === 'ignorieren') await bankZuordnen(txId, { art: 'ignorieren' }, u.id);
    else if (art === 'beleg' || art === 'rechnung') {
      if (!ziel) throw new Error('Bitte auswählen, wozu die Zahlung gehört.');
      await bankZuordnen(txId, { art, id: ziel }, u.id);
    } else if (art === 'auszahlung') {
      const d = pruefen(z.object({ provider: z.enum(['hobex', 'stripe', 'paypal', 'terminal'], 'Bitte den Anbieter wählen.'), gebuehr: z.string().optional().transform((s) => euroZuCent(s ?? '') ?? 0), von: z.string().optional(), bis: z.string().optional() }), fd);
      await bankZuordnen(txId, { art, provider: d.provider, gebuehrCents: d.gebuehr, von: tag(d.von), bis: tag(d.bis) }, u.id);
    } else if (art === 'konto') {
      const d = pruefen(z.object({ konto: z.string().transform((s) => s.trim().match(/^\d+/)?.[0] ?? '').refine(Boolean, 'Bitte ein Gegenkonto angeben.'), vatCode: steuercode, text: z.string().trim().max(120).optional().default('') }), fd);
      await bankZuordnen(txId, { art, konto: d.konto, vatCode: d.vatCode, text: d.text }, u.id);
    } else throw new Error('Bitte eine Zuordnung wählen.');
    await audit(u, 'bank.zuordnen', 'bank', txId, { art, ziel });
    neu();
    return art === 'ignorieren' ? 'Als ignoriert markiert.' : 'Gebucht.';
  });
}

export async function abrechnenAktion(_: Ergebnis): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const u = await assertRole('buchhaltung');
    const n = await vorstellungenAbrechnen();
    await audit(u, 'vorstellungen.abrechnen', 'journal', null, { anzahl: n });
    neu();
    return n ? `${n} Vorstellungen abgerechnet (Anzahlungen in Erlöse umgebucht).` : 'Alle vergangenen Vorstellungen sind bereits abgerechnet.';
  });
}

export async function festschreibenAktion(_: Ergebnis, fd: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const u = await assertRole('admin');
    const d = pruefen(z.object({ bis: datum }), fd);
    await festschreiben(tag(d.bis)!);
    neu();
    return `Buchungen bis ${fmtTagStr(d.bis)} festgeschrieben.`;
  });
}
