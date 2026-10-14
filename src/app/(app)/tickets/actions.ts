'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { audit } from '@/lib/audit';
import { assertRole, hat } from '@/lib/auth';
import { db } from '@/lib/db';
import { einlassZuruecknehmenLeitung } from '@/lib/einlass';
import { formatEur } from '@/lib/money';
import { ticketMail } from '@/lib/orders';
import { SITZ, sitzName } from '@/lib/saal';
import { PlatzBelegt } from '@/lib/seats';
import { ticketAendern } from '@/lib/umsetzen';
import { ausfuehren, type Ergebnis } from '@/components/verkauf/ergebnis';

const neu = (ticketId: string, orderId?: string) => {
  revalidatePath(`/tickets/${ticketId}`);
  if (orderId) revalidatePath(`/bestellungen/${orderId}`);
};

/** Buchungsbestätigung mit allen gültigen Tickets der Bestellung erneut senden */
export async function ticketSenden(ticketId: string, _: Ergebnis): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const u = await assertRole('leitung', 'kassa');
    const t = await db.ticket.findUniqueOrThrow({ where: { id: ticketId }, select: { orderId: true, code: true, status: true } });
    if (t.status === 'storniert') throw new Error('Das Ticket ist storniert.');
    const r = await ticketMail(t.orderId);
    if (!r) throw new Error('Für diese Bestellung ist keine E-Mail-Adresse hinterlegt.');
    if (!r.ok) throw new Error(`Versand fehlgeschlagen: ${'fehler' in r ? r.fehler : ''}`);
    await audit(u, 'tickets_senden', 'order', t.orderId, { mailId: r.id, ausTicket: t.code });
    neu(ticketId, t.orderId);
    return { ok: true, meldung: 'demo' in r && r.demo ? 'Tickets erstellt (Demo-Modus: E-Mail nur protokolliert).' : 'Tickets wurden erneut gesendet.' };
  });
}

export async function einlassZuruecknehmenAktion(ticketId: string, _: Ergebnis, fd: FormData): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const u = await assertRole('leitung');
    const grund = z.string().trim().min(3, 'Bitte einen Grund angeben (mind. 3 Zeichen)').max(300).parse(String(fd.get('grund') ?? ''));
    await einlassZuruecknehmenLeitung(ticketId, grund, u);
    const t = await db.ticket.findUnique({ where: { id: ticketId }, select: { orderId: true } });
    neu(ticketId, t?.orderId);
    return { ok: true, meldung: 'Einlass zurückgenommen – das Ticket ist wieder gültig.' };
  });
}

const umsetzenSchema = z.object({
  seatId: z.string().refine((id) => !!SITZ[id], 'Unbekannter Platz').optional(),
  art: z.enum(['normal', 'ermaessigt']).optional(),
  ausgleich: z.enum(['keine', 'gutschein']).default('keine'),
  kulanz: z.boolean().default(false),
  grund: z.string().trim().max(200).default(''),
});

/** Umsetzen/Tarif ändern ohne Kassa: gleich teuer, günstiger oder (Leitung) als Kulanz */
export async function umsetzenAktion(ticketId: string, eingabe: z.input<typeof umsetzenSchema>): Promise<Ergebnis> {
  return ausfuehren(async () => {
    const u = await assertRole('leitung', 'kassa', 'einlass');
    const d = umsetzenSchema.parse(eingabe);
    if (d.ausgleich === 'gutschein' && !hat(u, 'leitung', 'kassa')) throw new Error('Einen Gutschein stellen Leitung oder Kassa aus.');
    try {
      const r = await ticketAendern({ ticketId, seatId: d.seatId, art: d.art, ausgleich: d.ausgleich, kulanz: d.kulanz && hat(u, 'leitung'), grund: d.grund }, u);
      const t = await db.ticket.findUnique({ where: { id: ticketId }, select: { orderId: true, showId: true } });
      neu(ticketId, t?.orderId);
      if (t) revalidatePath(`/vorstellungen/${t.showId}`);
      return { ok: true, meldung: `Gespeichert: ${r.platz}${r.voucher ? `, Gutschein ${r.voucher.code} über ${formatEur(r.voucher.valueCents)}` : ''}${r.diff > 0 ? ' (Aufpreis als Kulanz erlassen)' : ''}.` };
    } catch (e) {
      if (e instanceof PlatzBelegt) return { fehler: `Der Platz ist inzwischen vergeben: ${e.seats.map(sitzName).join(', ')}. Bitte einen anderen wählen.` };
      throw e;
    }
  });
}
