import { db } from './db';
import type { Nutzer } from './auth';

export async function audit(u: Nutzer | null, action: string, entity: string, entityId?: string | null, data?: unknown) {
  await db.auditLog.create({ data: { userId: u?.id, userName: u?.name, action, entity, entityId: entityId ?? null, data: (data ?? undefined) as object | undefined } }).catch(() => {});
}
