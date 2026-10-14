// Gästeliste zum Ausdrucken (A4) für Kassa und Eingang: Name, Karten, Plätze, Grund, Kästchen zum Abhaken
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { audit } from '@/lib/audit';
import { requireRole } from '@/lib/auth';
import { db } from '@/lib/db';
import { fmtDatum, fmtDatumZeit, fmtZeit } from '@/lib/dates';
import { gaesteListe } from '@/lib/gaeste';
import { sitzName } from '@/lib/saal';
import DruckKnopf from '@/components/DruckKnopf';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Gästeliste drucken' };

const Kaestchen = ({ an, label }: { an: boolean; label: string }) => <span role="img" aria-label={`${label}: ${an ? 'ja' : 'nein'}`} className="inline-block size-4 border border-ink text-center text-[11px] leading-[14px]">{an ? '✓' : ''}</span>;

export default async function GaesteDruck({ params }: { params: Promise<{ id: string }> }) {
  const u = await requireRole('leitung', 'kassa', 'einlass');
  const { id } = await params;
  const show = await db.show.findUnique({ where: { id } });
  if (!show) notFound();
  const liste = await gaesteListe(id);
  await audit(u, 'gaesteliste_druck', 'show', id, { gaeste: liste.length });
  const karten = liste.reduce((n, g) => n + g.aktiv.length, 0);
  return (
    <main id="inhalt" className="min-h-dvh bg-white p-6 text-ink print:p-0">
      <style>{`@page { size: A4 portrait; margin: 12mm; } @media print { .nicht-drucken { display: none !important; } } table.liste td, table.liste th { border-bottom: 1px solid #c9c2b3; padding: 4px 6px; vertical-align: top; text-align: left; } table.liste thead th { border-bottom: 2px solid #121a2b; font-size: 12px; } table.liste tr { break-inside: avoid; }`}</style>
      <div className="nicht-drucken mb-4 flex flex-wrap gap-2">
        <Link href={`/vorstellungen/${id}/gaeste`} className="btn-secondary">Zurück zur Gästeliste</Link>
        <DruckKnopf>Gästeliste drucken</DruckKnopf>
      </div>
      <h1 className="text-xl font-semibold">Gästeliste {fmtDatum(show.startsAt)}, {fmtZeit(show.startsAt)} Uhr</h1>
      <p className="mb-3 text-sm">{show.title} · {liste.length} Gäste, {karten} Karten · Stand {fmtDatumZeit(new Date())} · Plätze als Reihe/Platz (R 5/12 = Reihe 5, Platz 12)</p>
      <div className="overflow-x-auto print:overflow-visible" tabIndex={0} role="region" aria-label="Liste, seitlich scrollbar">
      <table className="liste w-full min-w-[36rem] border-collapse text-[13px]">
        <thead><tr><th scope="col">Name</th><th scope="col">Karten</th><th scope="col">Plätze</th><th scope="col">Grund</th><th scope="col">Hinterlegt</th><th scope="col">Abgeholt</th><th scope="col">Eingelassen</th></tr></thead>
        <tbody>
          {liste.map((g) => {
            const c = g.customer;
            const ein = g.aktiv.filter((t) => t.status === 'eingelassen').length;
            return (
              <tr key={g.id}>
                <td><strong>{c ? `${c.lastName} ${c.firstName}`.trim() : '–'}</strong>{c?.company ? <><br /><span className="text-[11px]">{c.company}</span></> : null}<br /><span className="font-mono text-[10px]">{g.number}</span></td>
                <td>{g.aktiv.length}{g.gast.begleitung ? ' (inkl. +1)' : ''}</td>
                <td>{g.aktiv.map((t) => sitzName(t.seatId).replace('Reihe ', 'R ').replace(', Platz ', '/')).join(', ')}</td>
                <td>{g.gast.grund}</td>
                <td><Kaestchen an={g.gast.hinterlegt} label="Hinterlegt" /></td>
                <td><Kaestchen an={!!g.gast.abgeholtAm} label="Abgeholt" /></td>
                <td><Kaestchen an={g.aktiv.length > 0 && ein === g.aktiv.length} label="Eingelassen" /> {ein ? `${ein}/${g.aktiv.length}` : ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
      {!liste.length && <p className="mt-4">Keine Gäste auf der Liste.</p>}
    </main>
  );
}
