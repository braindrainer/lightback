'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { audit } from '@/lib/audit';
import { assertRole } from '@/lib/auth';
import { db } from '@/lib/db';
import { einlassZuruecknehmenLeitung } from '@/lib/einlass';
import { ticketMail } from '@/lib/orders';
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
