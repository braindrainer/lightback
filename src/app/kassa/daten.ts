// Gemeinsame Abfragen der Kassa-Seiten
import { cookies } from 'next/headers';
import { db } from '@/lib/db';

export const KASSE_COOKIE = 'lb_kasse';

/** Gewählte Kasse (?kasse=…, sonst Cookie, sonst die erste aktive) und deren offene Schicht */
export async function kasseWaehlen(kasse?: string) {
  const kassen = await db.register.findMany({ where: { active: true }, orderBy: { createdAt: 'asc' } });
  const gemerkt = (await cookies()).get(KASSE_COOKIE)?.value;
  const reg = kassen.find((k) => k.id === kasse) ?? kassen.find((k) => k.id === gemerkt) ?? kassen[0] ?? null;
  const schicht = reg ? await db.cashSession.findFirst({ where: { registerId: reg.id, closedAt: null } }) : null;
  return { kassen, reg, schicht };
}
