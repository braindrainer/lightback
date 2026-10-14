import { requireRole } from '@/lib/auth';
import { wienTag } from '@/lib/dates';
import { STANDARD_PREISE } from '@/lib/saal';
import { Abschnitt, PageHeader } from '@/components/ui';
import { EinzelFormular, SerienFormular } from '@/components/verkauf/VorstellungFormulare';
import { serieAnlegen, vorstellungAnlegen } from '../actions';

export const metadata = { title: 'Vorstellung anlegen' };

export default async function Neu() {
  await requireRole('leitung');
  const heute = wienTag(new Date());
  return (
    <>
      <PageHeader title="Vorstellungen anlegen" krumen={[{ label: 'Verkauf' }, { label: 'Vorstellungen', href: '/vorstellungen' }, { label: 'Anlegen' }]}
        sub="Eine ganze Serie mit Wochentagen und Uhrzeiten oder eine einzelne Vorstellung." />
      <div className="grid items-start gap-6 2xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Abschnitt id="serie-titel" titel="Serie anlegen" beschreibung="Zeitraum, Wochentage und Beginnzeiten – jede Kombination wird eine Vorstellung.">
          <SerienFormular action={serieAnlegen} preise={STANDARD_PREISE} heute={heute} />
        </Abschnitt>
        <Abschnitt id="einzel-titel" titel="Einzelne Vorstellung" beschreibung="Zusatztermin oder Sonderveranstaltung.">
          <EinzelFormular action={vorstellungAnlegen} preise={STANDARD_PREISE} heute={heute} />
        </Abschnitt>
      </div>
    </>
  );
}
