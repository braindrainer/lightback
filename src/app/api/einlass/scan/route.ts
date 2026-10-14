import { NextResponse } from 'next/server';
import { z } from 'zod';
import { scannen } from '@/lib/einlass';
import { mitRolle } from '../_hilfe';

export const dynamic = 'force-dynamic';

const Schema = z.object({
  qr: z.string().max(200).optional(),
  code: z.string().max(40).optional(),
  showId: z.string().min(1).max(40),
  offline: z.boolean().optional(),
  scannedAt: z.coerce.date().optional(),
  deviceId: z.string().max(60).optional(),
}).refine((d) => d.qr || d.code, 'QR-Inhalt oder Code fehlt');

/** Ticket prüfen und einlassen */
export async function POST(req: Request) {
  return mitRolle(async (u) => {
    const d = Schema.parse(await req.json());
    return NextResponse.json(await scannen({ eingabe: (d.qr ?? d.code)!, showId: d.showId, user: u, offline: d.offline, scannedAt: d.scannedAt, deviceId: d.deviceId }));
  });
}
