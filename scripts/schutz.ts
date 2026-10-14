// Datenbankschutz anwenden bzw. Kette prüfen. Läuft im Container vor dem Server (docker-entrypoint.sh).
//   npx tsx scripts/schutz.ts            Spalten, Altbestand versiegeln, Trigger
//   npx tsx scripts/schutz.ts --spalten  nur Spalten (vor prisma db push)
//   npx tsx scripts/schutz.ts --pruefen  Hash-Kette prüfen (Exit-Code 1 bei Bruch)
import { PrismaClient } from '@prisma/client';
import { ketteAusDb, schutzAnwenden } from '../src/lib/schutz';

const db = new PrismaClient();
const arg = process.argv[2];

async function main() {
  if (arg === '--pruefen') {
    const r = await ketteAusDb(db);
    console.log(JSON.stringify(r, null, 2));
    process.exitCode = r.ok ? 0 : 1;
    return;
  }
  const r = await schutzAnwenden(db, { nurSpalten: arg === '--spalten' });
  console.log(`Schutz: ${r.trigger} Trigger, ${r.versiegelt} ältere Protokolleinträge versiegelt${'hinweis' in r && r.hinweis ? ` (${r.hinweis})` : ''}`);
}

main().catch((e) => { console.error('Schutz fehlgeschlagen:', e); process.exitCode = 1; }).finally(() => db.$disconnect());
