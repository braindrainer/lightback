import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { PageHeader } from '@/components/ui';
import { AusstellenFormular, ImportFormular, VerkaufenFormular } from '@/components/verkauf/GutscheinFormulare';
import { gutscheineAusstellen, gutscheinVerkaufenAktion, partnerImport } from '../actions';

export const metadata = { title: 'Gutscheine anlegen' };

export default async function GutscheinNeu() {
  await requireRole('leitung', 'buchhaltung');
  return (
    <>
      <PageHeader title="Gutscheine anlegen" sub={<Link href="/gutscheine" className="underline underline-offset-4">Zurück zur Liste</Link>} />
      <section className="card mb-6 p-5" aria-labelledby="verkaufen"><h2 id="verkaufen" className="h2 mb-3">Gutschein verkaufen</h2><VerkaufenFormular action={gutscheinVerkaufenAktion} /></section>
      <section className="card mb-6 p-5" aria-labelledby="ausstellen"><h2 id="ausstellen" className="h2 mb-3">Eigene Gutscheine ausstellen</h2><AusstellenFormular action={gutscheineAusstellen} /></section>
      <section className="card p-5" aria-labelledby="import"><h2 id="import" className="h2 mb-3">Partner-Gutscheine importieren</h2><ImportFormular action={partnerImport} /></section>
    </>
  );
}
