// Druckbare Liste der Tagesanker (letzter Hash je Tag) – zum externen Ablegen
import Link from 'next/link';
import { audit } from '@/lib/audit';
import { requireRole } from '@/lib/auth';
import { getSettings } from '@/lib/db';
import { fmtDatumZeit } from '@/lib/dates';
import { tagesAnker } from '@/lib/protokoll-anker';
import DruckKnopf from '@/components/DruckKnopf';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Protokoll-Anker' };

export default async function Anker() {
  const u = await requireRole('admin');
  const [anker, s] = await Promise.all([tagesAnker(366), getSettings()]);
  await audit(u, 'protokoll_export', 'auditLog', null, { format: 'anker-druck', tage: anker.length });
  return (
    <main id="inhalt" className="mx-auto max-w-4xl bg-white p-6 text-ink print:p-0">
      <style>{'@media print { .nicht-drucken { display: none !important; } html, body { background: #fff !important; } }'}</style>
      <div className="nicht-drucken mb-5 flex flex-wrap gap-2">
        <Link href="/protokoll" className="btn-secondary">Zurück zum Protokoll</Link>
        <DruckKnopf>Drucken</DruckKnopf>
        <a href="/protokoll/export?format=anker" className="btn-secondary">Als Textdatei herunterladen</a>
      </div>
      <h1 className="h1">Tagesanker des Protokolls</h1>
      <p className="mt-1 text-sm">{s.companyName} · Lightback · erstellt {fmtDatumZeit(new Date())} von {u.name}</p>
      <p className="mt-3 text-sm">Je Kalendertag (Wien) der SHA-256-Hash des letzten Protokolleintrags. Weil jeder Eintrag den Hash seines Vorgängers enthält, bestätigt ein Anker alle Einträge bis zu diesem Tag. Ausgedruckt oder außerhalb des Systems abgelegt (z. B. per Mail an die Steuerberatung), lässt sich später nachweisen, dass nichts verändert wurde: Die Prüfung im Protokoll muss für denselben Eintrag denselben Hash ergeben.</p>
      <table className="table mt-5">
        <caption className="sr-only">Tagesanker, neueste zuerst</caption>
        <thead><tr><th scope="col">Tag</th><th scope="col" className="text-right">Letzte Nr.</th><th scope="col" className="text-right">Einträge</th><th scope="col">Hash (SHA-256)</th></tr></thead>
        <tbody>{anker.map((a) => <tr key={a.tag}><td className="num whitespace-nowrap">{a.tag}</td><td className="num text-right">{a.seq}</td><td className="num text-right">{a.anzahl}</td><td className="font-mono text-xs break-all">{a.hash ?? '–'}</td></tr>)}</tbody>
      </table>
    </main>
  );
}
