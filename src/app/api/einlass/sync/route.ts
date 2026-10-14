import { NextResponse } from 'next/server';
import { z } from 'zod';
import { audit } from '@/lib/audit';
import { scannen } from '@/lib/einlass';
import { mitRolle } from '../_hilfe';

export const dynamic = 'force-dynamic';

const Schema = z.object({
  deviceId: z.string().max(60).optional(),
  scans: z.array(z.object({ id: z.string().max(60), qr: z.string().max(200).optional(), code: z.string().max(40).optional(), showId: z.string().min(1).max(40), scannedAt: z.coerce.date() })).max(2000),
});

/**
 * Offline erfasste Scans nachreichen. Reihenfolge nach Scanzeit; wer zuerst eingelassen hat, gewinnt.
 * Lokal als „ok“ gewertete Scans, die der Server ablehnt, kommen als Konflikt zurück.
 */
export async function POST(req: Request) {
  return mitRolle(async (u) => {
    const d = Schema.parse(await req.json());
    const ergebnisse = [];
    for (const s of [...d.scans].sort((a, b) => a.scannedAt.getTime() - b.scannedAt.getTime())) {
      const eingabe = s.qr ?? s.code;
      if (!eingabe) continue;
      const r = await scannen({ eingabe, showId: s.showId, user: u, offline: true, scannedAt: s.scannedAt, deviceId: d.deviceId });
      ergebnisse.push({ id: s.id, ...r });
    }
    const konflikte = ergebnisse.filter((e) => e.result !== 'ok');
    await audit(u, 'einlass_sync', 'checkIn', null, { anzahl: ergebnisse.length, konflikte: konflikte.length });
    return NextResponse.json({ ergebnisse, konflikte });
  });
}
