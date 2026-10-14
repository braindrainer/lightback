import { currentUser, hat } from '@/lib/auth';
import { db } from '@/lib/db';
import { rechnungPdf, rechnungVorschauHtml } from '@/lib/finanzen/rechnungen';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await currentUser();
  if (!hat(u, 'buchhaltung', 'leitung')) return new Response('Keine Berechtigung', { status: 403 });
  const { id } = await params;
  // Leitung sieht nur Rechnungen aus Bestellungen, manuelle B2B-Rechnungen bleiben bei der Buchhaltung
  if (!hat(u, 'buchhaltung') && !(await db.invoice.findUnique({ where: { id }, select: { orderId: true } }))?.orderId) return new Response('Keine Berechtigung', { status: 403 });
  const url = new URL(req.url);
  try {
    if (url.searchParams.get('html')) {
      return new Response(await rechnungVorschauHtml(id), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; font-src 'self'; img-src 'self' data:; frame-ancestors 'self'" } });
    }
    const { pdf, name } = await rechnungPdf(id);
    return new Response(new Uint8Array(pdf), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `${url.searchParams.get('download') ? 'attachment' : 'inline'}; filename="${name}"`, 'Cache-Control': 'private, no-store' } });
  } catch (e) {
    return new Response(`PDF konnte nicht erstellt werden: ${(e as Error).message}`, { status: 500 });
  }
}
