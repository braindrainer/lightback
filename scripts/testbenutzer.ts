// Test-Admin für automatische Oberflächentests anlegen: TPW=… npx tsx scripts/testbenutzer.ts
import bcrypt from 'bcryptjs';
import { db } from '../src/lib/db';
(async () => {
  const passwordHash = await bcrypt.hash(process.env.TPW!, 10);
  await db.user.upsert({ where: { username: 'test' }, update: { passwordHash, active: true, roles: ['admin'] }, create: { username: 'test', email: 'test@example.org', name: 'Test Admin', passwordHash, roles: ['admin'] } });
  await db.$disconnect();
})();
