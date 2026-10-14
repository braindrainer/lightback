'use server';
// Aktionen rund um eine Vorstellung: Gästeliste (Freikarten), Nachricht an alle Gäste, Abbruch
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { audit } from '@/lib/audit';
import { assertRole } from '@/lib/auth';
import { db } from '@/lib/db';
import { formatEur } from '@/lib/money';
import { GAST_GRUENDE, GAST_MAX, gaesteImportieren, gastAnlegen, gastStornieren } from '@/lib/gaeste';
import { sitzName, SITZ } from '@/lib/saal';
import { PlatzBelegt } from '@/lib/seats';
import { nachrichtAnGaeste, vorstellungAbbrechen } from '@/lib/vorstellung';
import { ausfuehren, type Ergebnis } from '@/components/verkauf/ergebnis';

const neu = (showId: string) => {
  revalidatePath(`/vorstellungen/${showId}`);
  revalidatePath(`/vorstellungen/${showId}/gaeste`);
};
const leer = z.string().trim().max(200).optional().transform((v) => v || undefined);

const gastSchema = z.object({
  name: z.string().trim().min(2, 'Bitte den Namen angeben').max(120),
  email: z.union([z.literal(''), z.email('E-Mail-Adresse ist ungültig')]).optional().transform((v) => v?.toLowerCase() || undefined),
  phone: leer, company: leer,
  anzahl: z.coerce.number().int().min(1, 'Mindestens 1 Karte').max(GAST_MAX, `Höchstens ${GAST_MAX} Karten je Gast`),
  kat: z.enum(['I', 'II', 'R']).default('I'),
  seats: z.array(z.string().refine((id) => !!SITZ[id], 'Unbekannter Platz')).max(GAST_MAX + 1).optional(),
  grund: z.enum(GAST_GRUENDE, { message: 'Bitte einen Grund wählen' }),
  notiz: z.string().trim().max(500).default(''),
  mail: z.boolean().default(false),
  hinterlegt: z.boolean().default(false),
  begleitung: z.boolean().default(false),
});
export type GastFormEingabe = z.input<typeof gastSchema>;

export async function gastAnlegenAktion(showId: string, eingabe: GastFormEingabe | Record<string, unknown>): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const u = await assertRole('leitung');
    const d = gastSchema.parse(eingabe);
    try {
      const r = await gastAnlegen({ showId, ...d, seats: d.seats?.length ? d.seats : undefined }, u);
      neu(showId);
      const wege = [d.mail ? 'per E-Mail gesendet' : '', d.hinterlegt ? 'an der Kassa hinterlegt' : ''].filter(Boolean).join(' und ');
      return { ok: true, meldung: `${d.name}: ${r.anzahl} Freikarte(n) angelegt (${r.order.number}), ${wege}.${r.warnung ? ` ${r.warnung}` : ''}` };
    } catch (e) {
      if (e instanceof PlatzBelegt) return { fehler: `Diese Plätze sind inzwischen vergeben: ${e.seats.map(sitzName).join(', ')}.` };
      throw e;
    }
  });
}

export async function gaesteImportAktion(showId: string, _: Ergebnis, fd: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const u = await assertRole('leitung');
    const d = z.object({
      text: z.string().trim().min(3, 'Bitte die Liste einfügen').max(50_000),
      kat: z.enum(['I', 'II', 'R']),
      mail: z.literal('on').optional(),
      hinterlegt: z.literal('on').optional(),
    }).parse(Object.fromEntries(fd.entries()));
    const r = await gaesteImportieren(showId, d.text, { kat: d.kat, mail: !!d.mail, hinterlegt: !!d.hinterlegt }, u);
    neu(showId);
    const ok = r.ergebnis.filter((e) => e.ok).length;
    const fehler = r.ergebnis.filter((e) => !e.ok);
    const text = `${ok} von ${r.ergebnis.length} Gästen angelegt.${r.warnung ? ` ${r.warnung}` : ''}`;
    if (fehler.length) return { fehler: `${text} Nicht angelegt: ${fehler.map((e) => `Zeile ${e.zeile} (${e.name || '–'}): ${e.text}`).join('; ')}` };
    return { ok: true, meldung: text };
  });
}

export async function gastStornierenAktion(showId: string, orderId: string, _: Ergebnis, fd: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const u = await assertRole('leitung');
    const grund = z.string().trim().min(3, 'Bitte einen Grund angeben').max(200).parse(String(fd.get('grund') ?? ''));
    const o = await db.order.findUniqueOrThrow({ where: { id: orderId }, select: { showId: true } });
    if (o.showId !== showId) throw new Error('Die Bestellung gehört zu einer anderen Vorstellung');
    await gastStornieren(orderId, grund, u);
    neu(showId);
    return { ok: true, meldung: 'Freikarten storniert, die Plätze sind wieder frei.' };
  });
}

export async function kontingentAktion(showId: string, _: Ergebnis, fd: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const u = await assertRole('leitung');
    const roh = String(fd.get('limit') ?? '').trim();
    const limit = roh ? z.coerce.number().int().min(0, 'Kontingent darf nicht negativ sein').max(662).parse(roh) : null;
    const alt = await db.show.findUniqueOrThrow({ where: { id: showId }, select: { freikartenLimit: true } });
    await db.show.update({ where: { id: showId }, data: { freikartenLimit: limit } });
    await audit(u, 'freikarten_kontingent', 'show', showId, undefined, { vorher: { freikartenLimit: alt.freikartenLimit }, nachher: { freikartenLimit: limit } });
    neu(showId);
    return { ok: true, meldung: limit == null ? 'Kontingent entfernt (keine Grenze).' : `Kontingent: ${limit} Freikarten.` };
  });
}

export async function nachrichtAktion(showId: string, _: Ergebnis, fd: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const u = await assertRole('leitung');
    const d = z.object({
      betreff: z.string().trim().min(3, 'Bitte einen Betreff angeben').max(150),
      text: z.string().trim().min(10, 'Bitte einen Text mit mindestens 10 Zeichen angeben').max(5000),
      bestaetigt: z.literal('ja', { message: 'Bitte den Versand bestätigen' }),
    }).parse(Object.fromEntries(fd.entries()));
    const r = await nachrichtAnGaeste(showId, d.betreff, d.text, u);
    neu(showId);
    if (r.fehler.length) return { fehler: `${r.ok} von ${r.gesamt} Mails versendet. Fehler: ${r.fehler.slice(0, 5).join('; ')}` };
    return { ok: true, meldung: `Nachricht an ${r.ok} Gäste versendet (Protokoll unter E-Mails).` };
  });
}

export async function abbruchAktion(showId: string, _: Ergebnis, fd: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const u = await assertRole('leitung');
    const d = z.object({
      grund: z.string().trim().min(3, 'Bitte einen Grund angeben').max(500),
      prozent: z.coerce.number().int().min(0, '0 bis 100 %').max(100, '0 bis 100 %'),
      bestaetigt: z.literal('ja', { message: 'Bitte den Abbruch bestätigen' }),
    }).parse(Object.fromEntries(fd.entries()));
    const r = await vorstellungAbbrechen(showId, d.grund, d.prozent, u);
    neu(showId);
    revalidatePath('/vorstellungen');
    const text = `Vorstellung abgebrochen. ${r.ok} Bestellungen storniert, Gutscheine über insgesamt ${formatEur(r.gutscheinCents)}, ${r.mails} E-Mails.`;
    if (r.fehler.length) return { fehler: `${text} Fehler bei ${r.fehler.length}: ${r.fehler.join('; ')}` };
    return { ok: true, meldung: text };
  });
}
