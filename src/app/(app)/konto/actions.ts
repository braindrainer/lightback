'use server';
import bcrypt from 'bcryptjs';
import { audit } from '@/lib/audit';
import { assertRole } from '@/lib/auth';
import { db } from '@/lib/db';
import type { Ergebnis } from '@/components/system/Formular';

export async function passwortAendern(_p: Ergebnis, fd: FormData): Promise<Ergebnis> {
  const ich = await assertRole();
  const alt = String(fd.get('alt') ?? ''), neu = String(fd.get('neu') ?? ''), neu2 = String(fd.get('neu2') ?? '');
  if (neu.length < 12) return { fehler: 'Das neue Passwort braucht mindestens 12 Zeichen.' };
  if (neu !== neu2) return { fehler: 'Die beiden neuen Passwörter stimmen nicht überein.' };
  if (neu === alt) return { fehler: 'Das neue Passwort muss sich vom alten unterscheiden.' };
  const u = await db.user.findUniqueOrThrow({ where: { id: ich.id } });
  if (!(await bcrypt.compare(alt, u.passwordHash))) return { fehler: 'Das aktuelle Passwort stimmt nicht.' };
  await db.user.update({ where: { id: u.id }, data: { passwordHash: await bcrypt.hash(neu, 12) } });
  await audit(ich, 'passwort_geaendert', 'user', u.id);
  return { ok: 'Ihr Passwort wurde geändert.' };
}
