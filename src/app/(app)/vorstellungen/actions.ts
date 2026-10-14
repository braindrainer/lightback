'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { audit } from '@/lib/audit';
import { assertRole } from '@/lib/auth';
import { db } from '@/lib/db';
import { wienZuUtc } from '@/lib/dates';
import { parseAmountToCents } from '@/lib/money';
import { vorstellungAbsagen } from '@/lib/orders';
import { SITZ, type Preise } from '@/lib/saal';
import { entsperren, sperren } from '@/lib/seats';
import { ausfuehren, type Ergebnis } from '@/components/verkauf/ergebnis';
import { platzDaten } from '@/components/verkauf/daten';
import { SPERRGRUENDE } from '@/components/verkauf/texte';

const datum = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum im Format JJJJ-MM-TT');
const zeit = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Uhrzeit im Format HH:MM');
const betrag = (feld: string) => z.string().trim().min(1, `${feld} fehlt`).transform(parseAmountToCents).pipe(z.number().int().min(0, `${feld} darf nicht negativ sein`).max(100000, `${feld} ist zu hoch`));
const preisSchema = z.object({ I_normal: betrag('Kat. I Vollpreis'), I_erm: betrag('Kat. I ermäßigt'), II_normal: betrag('Kat. II Vollpreis'), II_erm: betrag('Kat. II ermäßigt'), R_normal: betrag('Rollstuhlplatz') });
const preiseAus = (p: z.infer<typeof preisSchema>): Preise => ({ I: { normal: p.I_normal, ermaessigt: p.I_erm }, II: { normal: p.II_normal, ermaessigt: p.II_erm }, R: { normal: p.R_normal } });
const obj = (fd: FormData) => Object.fromEntries(fd.entries());

/** Kalendertage von → bis (inkl.) als "YYYY-MM-DD" */
function tage(von: string, bis: string) {
  const out: { tag: string; wochentag: number }[] = [];
  const ende = Date.parse(`${bis}T00:00:00Z`);
  for (let t = Date.parse(`${von}T00:00:00Z`); t <= ende; t += 864e5) {
    const dt = new Date(t);
    out.push({ tag: dt.toISOString().slice(0, 10), wochentag: dt.getUTCDay() });
  }
  return out;
}

export async function serieAnlegen(_: Ergebnis, fd: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const u = await assertRole('leitung');
    const d = z.object({
      name: z.string().trim().min(1, 'Name der Serie fehlt').max(120),
      von: datum, bis: datum,
      zeiten: z.string().trim().min(1, 'Mindestens eine Uhrzeit'),
      dauer: z.coerce.number().int().min(5).max(600),
      status: z.enum(['verkauf', 'geplant']),
    }).and(preisSchema).parse(obj(fd));
    const wochentage = fd.getAll('wochentag').map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
    if (!wochentage.length) throw new Error('Bitte mindestens einen Wochentag wählen');
    const zeiten = [...new Set(d.zeiten.split(/[,;\s]+/).filter(Boolean))].map((x) => zeit.parse(x.padStart(5, '0')));
    if (d.bis < d.von) throw new Error('Das Enddatum liegt vor dem Startdatum');
    const liste = tage(d.von, d.bis).filter((t) => wochentage.includes(t.wochentag));
    const termine = liste.flatMap((t) => zeiten.map((zt) => wienZuUtc(t.tag, zt))).filter((t) => t > new Date());
    if (!termine.length) throw new Error('Mit diesen Angaben entsteht keine Vorstellung in der Zukunft');
    if (termine.length > 1500) throw new Error(`Zu viele Vorstellungen (${termine.length}) – bitte den Zeitraum verkürzen`);
    const vorhanden = new Set((await db.show.findMany({ where: { startsAt: { in: termine } }, select: { startsAt: true } })).map((s) => s.startsAt.getTime()));
    const neu = termine.filter((t) => !vorhanden.has(t.getTime()));
    if (!neu.length) throw new Error(`Alle ${termine.length} Termine gibt es schon – nichts angelegt.`);
    const prices = preiseAus(d);
    const serie = await db.showSeries.create({ data: { name: d.name, startDate: new Date(`${d.von}T00:00:00Z`), endDate: new Date(`${d.bis}T00:00:00Z`), weekdays: wochentage, times: zeiten, durationMin: d.dauer, prices } });
    await db.show.createMany({ data: neu.map((startsAt) => ({ seriesId: serie.id, startsAt, durationMin: d.dauer, status: d.status, prices })) });
    await audit(u, 'serie_anlegen', 'ShowSeries', serie.id, { name: d.name, neu: neu.length, uebersprungen: termine.length - neu.length });
    revalidatePath('/vorstellungen');
    return { ok: true, meldung: `${neu.length} Vorstellungen angelegt${termine.length - neu.length ? `, ${termine.length - neu.length} übersprungen (gab es schon)` : ''}.` };
  });
}

export async function vorstellungAnlegen(_: Ergebnis, fd: FormData): Promise<Ergebnis> {
  let id = '';
  const e = await ausfuehren(async () => {
    const u = await assertRole('leitung');
    const d = z.object({ datum, zeit, dauer: z.coerce.number().int().min(5).max(600), status: z.enum(['verkauf', 'geplant', 'pausiert']), notes: z.string().max(2000).default(''), titel: z.string().trim().min(1).max(120) }).and(preisSchema).parse(obj(fd));
    const startsAt = wienZuUtc(d.datum, d.zeit);
    if (startsAt < new Date()) throw new Error('Der Termin liegt in der Vergangenheit');
    if (await db.show.findFirst({ where: { startsAt, status: { not: 'abgesagt' } } })) throw new Error('Zu diesem Zeitpunkt gibt es schon eine Vorstellung');
    const s = await db.show.create({ data: { startsAt, title: d.titel, durationMin: d.dauer, status: d.status, notes: d.notes, prices: preiseAus(d) } });
    id = s.id;
    await audit(u, 'vorstellung_anlegen', 'Show', s.id, { startsAt });
    revalidatePath('/vorstellungen');
  });
  if (id) redirect(`/vorstellungen/${id}`);
  return e;
}

export async function vorstellungBearbeiten(showId: string, _: Ergebnis, fd: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const u = await assertRole('leitung');
    const show = await db.show.findUniqueOrThrow({ where: { id: showId } });
    if (show.status === 'abgesagt') throw new Error('Abgesagte Vorstellungen können nicht mehr bearbeitet werden');
    const d = z.object({ datum, zeit, status: z.enum(['verkauf', 'pausiert', 'geplant']), notes: z.string().max(2000).default(''), titel: z.string().trim().min(1).max(120) }).and(preisSchema).parse(obj(fd));
    const startsAt = wienZuUtc(d.datum, d.zeit);
    if (startsAt.getTime() !== show.startsAt.getTime() && (await db.show.findFirst({ where: { startsAt, id: { not: showId }, status: { not: 'abgesagt' } } }))) throw new Error('Zu diesem Zeitpunkt gibt es schon eine Vorstellung');
    await db.show.update({ where: { id: showId }, data: { startsAt, status: d.status, notes: d.notes, title: d.titel, prices: preiseAus(d) } });
    await audit(u, 'vorstellung_bearbeiten', 'Show', showId, { vorher: { startsAt: show.startsAt, status: show.status, prices: show.prices }, nachher: { startsAt, status: d.status, prices: preiseAus(d) } });
    revalidatePath(`/vorstellungen/${showId}`);
    revalidatePath('/vorstellungen');
    return { ok: true, meldung: 'Gespeichert.' };
  });
}

export async function vorstellungAbsagenAktion(showId: string, _: Ergebnis, fd: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const u = await assertRole('leitung');
    const d = z.object({ grund: z.string().trim().min(3, 'Bitte einen Grund angeben').max(500), methode: z.enum(['zahlungsmittel', 'gutschein']), bestaetigt: z.literal('ja', { message: 'Bitte bestätigen Sie die Absage' }) }).parse(obj(fd));
    const show = await db.show.findUniqueOrThrow({ where: { id: showId } });
    if (show.status === 'abgesagt') throw new Error('Die Vorstellung ist bereits abgesagt');
    const r = await vorstellungAbsagen(showId, d.grund, d.methode, u.id);
    await audit(u, 'vorstellung_absagen', 'Show', showId, { grund: d.grund, methode: d.methode, ...r });
    revalidatePath(`/vorstellungen/${showId}`);
    revalidatePath('/vorstellungen');
    const text = `Vorstellung abgesagt. ${r.ok} Bestellungen storniert${d.methode === 'gutschein' ? ' (Gutscheine ausgestellt)' : ' und erstattet'}.`;
    if (r.fehler.length) return { fehler: `${text} Fehler bei ${r.fehler.length}: ${r.fehler.join('; ')}` };
    return { ok: true, meldung: text };
  });
}

const sitzIds = z.array(z.string().refine((id) => !!SITZ[id], 'Unbekannter Platz')).min(1, 'Keine Plätze gewählt').max(700);

export async function sitzeSperren(showId: string, ids: string[], grund: string): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const u = await assertRole('leitung');
    const d = z.object({ ids: sitzIds, grund: z.enum(SPERRGRUENDE) }).parse({ ids, grund });
    await sperren(showId, d.ids, d.grund);
    await audit(u, 'plaetze_sperren', 'Show', showId, d);
    revalidatePath(`/vorstellungen/${showId}`);
    return { ok: true, meldung: `${d.ids.length} ${d.ids.length === 1 ? 'Platz' : 'Plätze'} gesperrt (${d.grund}).` };
  });
}

export async function sitzeEntsperren(showId: string, ids: string[]): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const u = await assertRole('leitung');
    const d = sitzIds.parse(ids);
    await entsperren(showId, d);
    await audit(u, 'plaetze_entsperren', 'Show', showId, { ids: d });
    revalidatePath(`/vorstellungen/${showId}`);
    return { ok: true, meldung: `${d.length} ${d.length === 1 ? 'Platz' : 'Plätze'} entsperrt.` };
  });
}

/** Sammelaktion aus der Liste: Verkauf pausieren oder öffnen */
export async function sammelStatus(fd: FormData) {
  const u = await assertRole('leitung');
  const ids = z.array(z.string().min(1)).max(500).parse(fd.getAll('ids').map(String));
  const ziel = z.enum(['pausiert', 'verkauf']).parse(fd.get('aktion'));
  const zurueck = String(fd.get('zurueck') ?? '/vorstellungen');
  let n = 0;
  if (ids.length) {
    const r = await db.show.updateMany({ where: { id: { in: ids }, status: { in: ziel === 'pausiert' ? ['verkauf', 'geplant'] : ['pausiert', 'geplant'] } }, data: { status: ziel } });
    n = r.count;
    await audit(u, ziel === 'pausiert' ? 'verkauf_pausieren' : 'verkauf_oeffnen', 'Show', null, { ids, geaendert: n });
  }
  revalidatePath('/vorstellungen');
  const sep = zurueck.includes('?') ? '&' : '?';
  redirect(`${zurueck.startsWith('/vorstellungen') ? zurueck : '/vorstellungen'}${sep}meldung=${encodeURIComponent(ids.length ? `${n} von ${ids.length} Vorstellungen: ${ziel === 'pausiert' ? 'Verkauf pausiert' : 'Verkauf geöffnet'}.` : 'Keine Vorstellung ausgewählt.')}`);
}

/** Platzstatus für Saalplan (Telefonverkauf, Umbuchung) */
export async function plaetzeLaden(showId: string) {
  await assertRole('leitung', 'kassa');
  const s = await db.show.findUniqueOrThrow({ where: { id: z.string().min(1).parse(showId) } });
  const d = await platzDaten(s.id);
  return { status: d.status, preise: s.prices as Preise };
}
