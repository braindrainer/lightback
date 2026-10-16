import { audit } from '@/lib/audit';
import { currentUser, hat } from '@/lib/auth';
import { db } from '@/lib/db';
import { abgeholt, dateiLatin1, dateiName } from '@/lib/finanzen/bmd-uebergabe';
import { modulAn } from '@/lib/module';

export const dynamic = 'force-dynamic';

/** Importdatei eines Laufs herunterladen (für den manuellen Import in BMD) */
export async function GET(_req: Request, { params }: { params: Promise<{ nummer: string }> }) {
  const u = await currentUser();
  if (!hat(u, 'buchhaltung')) return new Response('Keine Berechtigung', { status: 403 });
  if (!(await modulAn('bmd'))) return new Response('BMD-Übergabe ist ausgeschaltet', { status: 403 });
  const l = await db.bmdLauf.findUnique({ where: { nummer: Number((await params).nummer) || -1 } });
  if (!l) return new Response('Lauf nicht gefunden', { status: 404 });
  await abgeholt(l, u!.name, u!.id);
  await audit(u, 'export.bmd_lauf', 'bmdLauf', l.id, { nummer: l.nummer });
  return new Response(new Uint8Array(dateiLatin1(l.datei)), { headers: { 'Content-Type': 'text/csv; charset=iso-8859-1', 'Content-Disposition': `attachment; filename="${dateiName(l)}"`, 'Cache-Control': 'no-store' } });
}
