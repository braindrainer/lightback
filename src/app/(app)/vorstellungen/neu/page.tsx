import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { wienTag } from '@/lib/dates';
import { STANDARD_PREISE } from '@/lib/saal';
import { PageHeader } from '@/components/ui';
import { EinzelFormular, SerienFormular } from '@/components/verkauf/VorstellungFormulare';
import { serieAnlegen, vorstellungAnlegen } from '../actions';

export const metadata = { title: 'Vorstellung anlegen' };

export default async function Neu() {
  await requireRole('leitung');
  const heute = wienTag(new Date());
  return (
    <>
      <PageHeader title="Vorstellungen anlegen" sub={<Link href="/vorstellungen" className="underline underline-offset-4">Zurück zur Liste</Link>} />
      <section className="card mb-6 p-5" aria-labelledby="serie-titel">
        <h2 id="serie-titel" className="h2 mb-4">Serie anlegen</h2>
        <SerienFormular action={serieAnlegen} preise={STANDARD_PREISE} heute={heute} />
      </section>
      <section className="card p-5" aria-labelledby="einzel-titel">
        <h2 id="einzel-titel" className="h2 mb-4">Einzelne Vorstellung</h2>
        <EinzelFormular action={vorstellungAnlegen} preise={STANDARD_PREISE} heute={heute} />
      </section>
    </>
  );
}
