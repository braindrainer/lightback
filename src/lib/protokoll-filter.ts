// Filter für Protokollseite und -export (gleiche Regeln an beiden Stellen)
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { bereiche } from './audit';
import { db } from './db';
import { wienZuUtc } from './dates';

const tag = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined);
const text = z.string().trim().max(200).optional().catch(undefined);
export const filterSchema = z.object({ von: tag, bis: tag, benutzer: text, aktion: text, entity: text, id: text, q: text });
export type Filter = z.infer<typeof filterSchema>;

export function filterLesen(sp: Record<string, string | string[] | undefined>): Filter {
  const roh = Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v || undefined]));
  return filterSchema.parse(roh);
}

export async function filterWhere(f: Filter): Promise<Prisma.AuditLogWhereInput> {
  const and: Prisma.AuditLogWhereInput[] = [];
  if (f.aktion) and.push({ action: { contains: f.aktion, mode: 'insensitive' } });
  if (f.entity) and.push({ entity: { in: bereiche(f.entity) } });
  if (f.id) and.push({ entityId: f.id });
  if (f.benutzer) and.push(f.benutzer.toLowerCase() === 'system' ? { userId: null } : { userName: { contains: f.benutzer, mode: 'insensitive' } });
  if (f.von) and.push({ createdAt: { gte: wienZuUtc(f.von, '00:00') } });
  if (f.bis) and.push({ createdAt: { lt: new Date(wienZuUtc(f.bis, '00:00').getTime() + 864e5) } });
  if (f.q) {
    // Volltext über Aktion, Benutzer, IDs und alle JSON-Daten
    const muster = `%${f.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    const ids = await db.$queryRaw<{ id: string }[]>`
      SELECT id FROM "AuditLog"
      WHERE concat_ws(' ', action, entity, "entityId", "userName", ip, data::text, vorher::text, nachher::text) ILIKE ${muster}
      ORDER BY seq DESC LIMIT 5000`;
    and.push({ id: { in: ids.map((x) => x.id) } });
  }
  return and.length ? { AND: and } : {};
}

export const filterQuery = (f: Filter, extra: Record<string, string> = {}) =>
  new URLSearchParams({ ...(Object.fromEntries(Object.entries(f).filter(([, v]) => v)) as Record<string, string>), ...extra }).toString();
