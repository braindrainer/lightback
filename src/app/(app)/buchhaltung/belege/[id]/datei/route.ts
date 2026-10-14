import { currentUser, hat } from '@/lib/auth';
import { db } from '@/lib/db';
import { lesen, MIME } from '@/lib/finanzen/dateien';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await currentUser();
  if (!hat(u, 'buchhaltung')) return new Response('Keine Berechtigung', { status: 403 });
  const { id } = await params;
  const e = await db.expense.findUnique({ where: { id } });
  if (!e?.filePath) return new Response('Keine Datei', { status: 404 });
  try {
    const inhalt = await lesen(e.filePath);
    const ext = e.filePath.split('.').pop()!.toLowerCase();
    const name = e.fileName ?? `beleg.${ext}`;
    const art = new URL(req.url).searchParams.get('download') ? 'attachment' : 'inline';
    return new Response(new Uint8Array(inhalt), { headers: { 'Content-Type': MIME[ext] ?? 'application/octet-stream', 'Content-Disposition': `${art}; filename="${name}"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
  } catch {
    return new Response('Datei nicht gefunden', { status: 404 });
  }
}
