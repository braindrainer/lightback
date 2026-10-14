import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { db } from '@/lib/db';
import { fmtDatumZeit } from '@/lib/dates';
import { Formular } from '@/components/system/Formular';
import { DetailKopf, Feldliste, StatusPill } from '@/components/ui';
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
      <DetailKopf krumen={[{ label: 'System' }, { label: 'E-Mails', href: '/emails' }, { label: VORLAGE_NAME[m.template] ?? m.template }]}
        titel={<span className="font-sans text-2xl font-semibold tracking-tight">{m.subject}</span>} status={<StatusPill status={m.status} />}
        untertitel={<>An {m.to} · {fmtDatumZeit(m.createdAt)}</>} />
      <div className="grid items-start gap-6 lg:grid-cols-[1fr_20rem]">
        <section aria-label="Inhalt der Mail" className="card overflow-hidden bg-[#efe9de]">
          {/* Mail-HTML isoliert: keine Skripte, keine Formulare, kein Zugriff auf diese Seite */}
          <iframe title={`Inhalt: ${m.subject}`} srcDoc={m.html} sandbox="" className="h-[75vh] w-full bg-white" />
        </section>
        <aside className="grid content-start gap-4">
          <div className="card p-5">
            <Feldliste spalten={1} felder={[
              { label: 'Status', wert: <StatusPill status={m.status} /> },
              { label: 'An', wert: <span className="break-all">{m.to}</span>, kopieren: m.to },
              { label: 'Vorlage', wert: VORLAGE_NAME[m.template] ?? m.template },
              { label: 'Erstellt', wert: fmtDatumZeit(m.createdAt) },
              { label: 'Gesendet', wert: m.sentAt ? fmtDatumZeit(m.sentAt) : '–' },
              m.order && { label: 'Bestellung', wert: <Link href={`/bestellungen/${m.order.id}`} className="link font-mono">{m.order.number}</Link> },
              m.error && { label: 'Fehler', wert: <span className="text-neg">{m.error}</span> },
            ]} />
          </div>
          <Formular action={erneutSenden} knopf="Erneut senden" variante="btn-secondary" bestaetigen={`Diese Mail erneut an ${m.to} senden?`} className="card p-4">
            <input type="hidden" name="id" value={m.id} />
            <p className="text-sm text-muted">{m.template === 'buchung' && m.orderId ? 'Die Buchungsbestätigung wird mit aktuellen Tickets und QR-Codes neu erzeugt.' : 'Schickt denselben Inhalt noch einmal.'}</p>
          </Formular>
        </aside>
      </div>
    </>
  );
}
