import { NextResponse } from 'next/server';
import { audit } from '@/lib/audit';
import { assertRole } from '@/lib/auth';
import { db } from '@/lib/db';
import { depExport } from '@/lib/rksv';
import { modulAn } from '@/lib/module';

export const dynamic = 'force-dynamic';

/** Datenerfassungsprotokoll (DEP) einer Kasse als JSON-Datei (RKSV, Export auf Verlangen der Finanzverwaltung) */
export async function GET(req: Request) {
  let u;
  try { u = await assertRole('admin'); } catch { return NextResponse.json({ fehler: 'Keine Berechtigung' }, { status: 403 }); }
  if (!(await modulAn('kassa'))) return NextResponse.json({ fehler: 'Kassa ist ausgeschaltet' }, { status: 403 });
  const q = new URL(req.url).searchParams;
  const reg = await db.register.findUnique({ where: { id: q.get('registerId') ?? '' } });
  if (!reg) return NextResponse.json({ fehler: 'Kasse nicht gefunden' }, { status: 404 });
  const von = q.get('von') ? new Date(q.get('von')!) : undefined;
  const bis = q.get('bis') ? new Date(q.get('bis')!) : undefined;
  const dep = await depExport(reg.id, von, bis);
  await audit(u, 'dep_export', 'register', reg.id, { anzahl: dep['Belege-Gruppe'][0]['Belege-kompakt'].length });
  return new NextResponse(JSON.stringify(dep, null, 2), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="DEP-${reg.kassenId}-${new Date().toISOString().slice(0, 10)}.json"`, 'Cache-Control': 'no-store' },
  });
}
