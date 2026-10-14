import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { db } from '@/lib/db';
import { fmtDatumZeit } from '@/lib/dates';
import { Formular } from '@/components/system/Formular';
import { PageHeader, StatusPill } from '@/components/ui';
import { erneutSenden } from '../actions';
import { VORLAGE_NAME } from '../vorlagen/platzhalter';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'E-Mail' };

export default async function Mail({ params }: { params: Promise<{ id: string }> }) {
  await requireRole('leitung');
  const m = await db.emailLog.findUnique({ where: { id: (await params).id }, include: { order: { select: { id: true, number: true } } } });
  if (!m) notFound();
  return (
    <>
      <PageHeader title={m.subject} sub={`${VORLAGE_NAME[m.template] ?? m.template} · ${fmtDatumZeit(m.createdAt)}`}>
        <Link href="/emails" className="btn-secondary">Zur Liste</Link>
      </PageHeader>
      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        <section aria-label="Inhalt der Mail" className="card overflow-hidden">
          {/* Mail-HTML isoliert: keine Skripte, keine Formulare, kein Zugriff auf diese Seite */}
          <iframe title={`Inhalt: ${m.subject}`} srcDoc={m.html} sandbox="" className="h-[75vh] w-full bg-white" />
        </section>
        <aside className="grid content-start gap-4">
          <dl className="card grid gap-2 p-4 text-sm">
            <div><dt className="text-xs text-muted">Status</dt><dd><StatusPill status={m.status} /></dd></div>
            <div><dt className="text-xs text-muted">An</dt><dd className="break-all">{m.to}</dd></div>
            <div><dt className="text-xs text-muted">Erstellt</dt><dd>{fmtDatumZeit(m.createdAt)}</dd></div>
            <div><dt className="text-xs text-muted">Gesendet</dt><dd>{m.sentAt ? fmtDatumZeit(m.sentAt) : '–'}</dd></div>
            {m.order && <div><dt className="text-xs text-muted">Bestellung</dt><dd><Link href={`/bestellungen/${m.order.id}`} className="font-mono underline underline-offset-4">{m.order.number}</Link></dd></div>}
            {m.error && <div><dt className="text-xs text-muted">Fehler</dt><dd className="text-neg">{m.error}</dd></div>}
          </dl>
          <Formular action={erneutSenden} knopf="Erneut senden" variante="btn-secondary" bestaetigen={`Diese Mail erneut an ${m.to} senden?`} className="card p-4">
            <input type="hidden" name="id" value={m.id} />
            <p className="text-sm text-muted">{m.template === 'buchung' && m.orderId ? 'Die Buchungsbestätigung wird mit aktuellen Tickets und QR-Codes neu erzeugt.' : 'Schickt denselben Inhalt noch einmal.'}</p>
          </Formular>
        </aside>
      </div>
    </>
  );
}
