import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { Formular } from '@/components/system/Formular';
import { PageHeader } from '@/components/ui';
import { partnerAnlegen } from '../actions';
import { PartnerFelder } from '../Felder';

export const metadata = { title: 'Partner anlegen' };

export default async function Neu() {
  await requireRole('leitung');
  return (
    <>
      <PageHeader title="Partner anlegen" krumen={[{ label: 'Verkauf' }, { label: 'Partner & API', href: '/partner' }, { label: 'Anlegen' }]} sub="Der API-Schlüssel wird beim Anlegen erzeugt und nur einmal angezeigt." />
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Formular action={partnerAnlegen} knopf="Anlegen und Schlüssel erzeugen" className="card !overflow-visible p-5"><h2 className="h2 mb-3">Vertrag und Zugang</h2><PartnerFelder /></Formular>
        <aside className="card p-5 text-sm" aria-labelledby="h-ablauf">
          <h2 id="h-ablauf" className="h2">So geht es weiter</h2>
          <ol className="mt-3 grid list-decimal gap-2 pl-5 text-muted">
            <li>Partner anlegen – der Schlüssel erscheint einmalig.</li>
            <li>Schlüssel sicher an den Partner übergeben.</li>
            <li>Partner verbindet sich laut <Link href="/api-doku" className="link">API-Dokumentation</Link>.</li>
            <li>Verkäufe erscheinen unter Bestellungen mit Kanal „Partner“.</li>
          </ol>
        </aside>
      </div>
    </>
  );
}
