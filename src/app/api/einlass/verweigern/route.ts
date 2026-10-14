import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db';
import { codeAus, verweigern, VERWEIGERUNGSGRUENDE } from '@/lib/einlass';
import { mitRolle } from '../_hilfe';

export const dynamic = 'force-dynamic';

/** Einlass verweigern – das Ticket bleibt gültig; ein gerade erfolgter Einlass wird zurückgenommen */
export async function POST(req: Request) {
  return mitRolle(async (u) => {
    const d = z.object({
      showId: z.string().min(1).max(40), ticketId: z.string().max(40).optional(), code: z.string().max(200).optional(),
      grund: z.enum(VERWEIGERUNGSGRUENDE), notiz: z.string().trim().max(200).optional(), checkInId: z.string().max(40).optional(), deviceId: z.string().max(60).optional(),
    }).refine((x) => x.ticketId || x.code, 'Ticket fehlt').parse(await req.json());
    let ticketId = d.ticketId;
    if (!ticketId) {
      const c = codeAus(d.code!);
      const t = c ? await db.ticket.findUnique({ where: { code: c.code }, select: { id: true } }) : null;
      if (!t) throw new Error('Ticket nicht gefunden.');
      ticketId = t.id;
    }
    return NextResponse.json(await verweigern({ ticketId, showId: d.showId, grund: d.grund, notiz: d.notiz, checkInId: d.checkInId, user: u, deviceId: d.deviceId }));
  });
}
