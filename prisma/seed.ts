// Grunddaten: Kontenplan, Einstellungen, Vorstellungen (Serie), Kassa-Artikel, eine Kasse.
// Admin anlegen: SEED_USER=name SEED_PW='…' SEED_EMAIL=… npx tsx prisma/seed.ts
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { db } from '../src/lib/db';
import { wienTag, wienZuUtc } from '../src/lib/dates';
import { seedKonten } from '../src/lib/ledger';
import { STANDARD_PREISE } from '../src/lib/saal';
import { encrypt } from '../src/lib/secret';

async function main() {
  await db.settings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  await seedKonten();

  if (process.env.SEED_USER && process.env.SEED_PW) {
    const username = process.env.SEED_USER.toLowerCase();
    const email = (process.env.SEED_EMAIL ?? `${username}@skillful.at`).toLowerCase();
    const passwordHash = await bcrypt.hash(process.env.SEED_PW, 12);
    await db.user.upsert({ where: { username }, update: { passwordHash, active: true, roles: ['admin'] }, create: { username, email, name: process.env.SEED_NAME ?? username, passwordHash, roles: ['admin'] } });
    console.log('Admin', username, 'angelegt');
  }

  if (!(await db.showSeries.count())) {
    const start = new Date();
    const ende = new Date(Date.now() + 120 * 864e5);
    const serie = await db.showSeries.create({ data: { name: 'Spielzeit 2026/27', startDate: new Date(wienTag(start)), endDate: new Date(wienTag(ende)), weekdays: [0, 1, 3, 4, 5, 6], times: ['18:30', '20:00'], prices: STANDARD_PREISE } });
    const shows = [];
    for (let d = new Date(start); d <= ende; d = new Date(d.getTime() + 864e5)) {
      const tag = wienTag(d);
      const wt = new Date(`${tag}T12:00:00Z`).getUTCDay();
      if (!serie.weekdays.includes(wt)) continue;
      for (const t of serie.times) shows.push({ seriesId: serie.id, startsAt: wienZuUtc(tag, t), prices: STANDARD_PREISE, status: 'verkauf' });
    }
    await db.show.createMany({ data: shows });
    console.log(shows.length, 'Vorstellungen');
  }

  if (!(await db.product.count())) {
    await db.product.createMany({ data: [
      { name: 'Abendkasse Kat. I', category: 'ticket', priceCents: 2800, vatRate: 13, sort: 1 },
      { name: 'Abendkasse Kat. II', category: 'ticket', priceCents: 2400, vatRate: 13, sort: 2 },
      { name: 'Programmheft', category: 'merch', priceCents: 800, vatRate: 10, sort: 10 },
      { name: 'Poster', category: 'merch', priceCents: 1500, vatRate: 20, sort: 11 },
      { name: 'Kerze Votivkirche', category: 'merch', priceCents: 600, vatRate: 20, sort: 12 },
      { name: 'Wasser 0,5 l', category: 'getraenk', priceCents: 350, vatRate: 20, sort: 20 },
      { name: 'Wertgutschein 50 €', category: 'sonstiges', priceCents: 5000, vatRate: 0, sort: 30 },
    ] });
  }

  if (!(await db.register.count())) {
    await db.register.create({ data: { name: 'Kassa Eingang', kassenId: 'LOC-KASSA-1', aesKeyEnc: encrypt(randomBytes(32).toString('base64')) } });
  }
}

main().then(() => db.$disconnect()).catch((e) => { console.error(e); process.exit(1); });
