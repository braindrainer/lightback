import Link from 'next/link';
import { hat, requireRole } from '@/lib/auth';
import { db } from '@/lib/db';
import { fmtDatumZeit, fmtTag, fmtZeit, wienTag, wienZuUtc } from '@/lib/dates';
import { formatEur } from '@/lib/money';
import type { Preise } from '@/lib/saal';
import { auslastung } from '@/lib/seats';
import { kasseSetzenAction, schichtOeffnenAction } from './actions';
import { kasseWaehlen } from './daten';
import KassaApp from './KassaApp';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Verkauf' };

export default async function KassaSeite({ searchParams }: { searchParams: Promise<{ kasse?: string; fehler?: string }> }) {
  const u = await requireRole('kassa');
  const { kasse, fehler } = await searchParams;
  const { kassen, reg, schicht } = await kasseWaehlen(kasse);

  const kopf = (
    <div className="flex flex-wrap items-center gap-3">
      <h1 className="h1">Kassa{reg ? `: ${reg.name}` : ''}</h1>
      {kassen.length > 1 && reg && (
        <form action={kasseSetzenAction} className="flex w-full min-w-0 items-center gap-2 sm:w-auto">
          <label htmlFor="kassewahl" className="text-sm text-muted">Kasse</label>
          <select id="kassewahl" name="registerId" defaultValue={reg.id} className="input min-h-12 min-w-0 flex-1">{kassen.map((k) => <option key={k.id} value={k.id}>{k.name} ({k.kassenId})</option>)}</select>
          <button className="btn-secondary min-h-12">Wechseln</button>
        </form>
      )}
    </div>
  );
  const hinweis = fehler && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-base text-neg">{fehler}</p>;

  if (!reg || !reg.startedAt || !schicht) {
    return (
      <div className="mx-auto grid w-full max-w-xl gap-4 px-4 py-6">
        {kopf}
        {hinweis}
        {!reg ? (
          <p className="card p-5 text-base">Es ist noch keine Kasse eingerichtet. {hat(u, 'admin') ? <Link href="/kassa/einrichtung" className="font-semibold underline">Zur Einrichtung</Link> : 'Bitte die Administration verständigen.'}</p>
        ) : !reg.startedAt ? (
          <p className="card p-5 text-base">Für {reg.kassenId} fehlt der <strong>Startbeleg</strong> – vorher ist kein Verkauf erlaubt (RKSV). {hat(u, 'admin') ? <Link href="/kassa/einrichtung" className="font-semibold underline">Startbeleg erstellen</Link> : 'Bitte die Administration verständigen.'}</p>
        ) : (
          <form action={schichtOeffnenAction} className="card grid gap-4 p-5">
            <h2 className="h2 text-lg">Schicht öffnen</h2>
            <input type="hidden" name="registerId" value={reg.id} />
            <div>
              <label htmlFor="wechselgeld" className="label text-sm">Wechselgeld in der Lade (€)</label>
              <input id="wechselgeld" name="wechselgeld" inputMode="decimal" required defaultValue="100,00" className="input min-h-14 text-2xl" aria-describedby="wg-hinweis" />
              <p id="wg-hinweis" className="mt-1 text-sm text-muted">Anfangsbestand laut Zählung. Er erscheint im Kassabericht.</p>
            </div>
            <button className="btn-primary min-h-14 text-lg">Schicht öffnen</button>
          </form>
        )}
      </div>
    );
  }

  const jetzt = new Date();
  const tagEnde = new Date(wienZuUtc(wienTag(jetzt), '00:00').getTime() + 864e5);
  const [produkte, shows] = await Promise.all([
    db.product.findMany({ where: { active: true }, orderBy: [{ sort: 'asc' }, { name: 'asc' }] }),
    db.show.findMany({ where: { status: 'verkauf', startsAt: { gt: jetzt, lt: new Date(Math.max(tagEnde.getTime(), jetzt.getTime() + 6 * 3600e3)) } }, orderBy: { startsAt: 'asc' }, take: 4 }),
  ]);
  const showDaten = await Promise.all(shows.map(async (s) => {
    const a = await auslastung(s.id);
    return { id: s.id, label: `${fmtTag(s.startsAt)}, ${fmtZeit(s.startsAt)} Uhr`, prices: s.prices as Preise, frei: { I: a.jeKat.I.frei, II: a.jeKat.II.frei, R: a.jeKat.R.frei } };
  }));
  return (
    <KassaApp
      kasse={{ id: reg.id, name: reg.name, kassenId: reg.kassenId, signer: reg.signer }}
      schicht={{ id: schicht.id, seit: fmtDatumZeit(schicht.openedAt), von: schicht.openedByName, wechselgeld: formatEur(schicht.floatCents) }}
      produkte={produkte.map((p) => ({ id: p.id, name: p.name, category: p.category, priceCents: p.priceCents, vatRate: p.vatRate, color: p.color, sku: p.sku, stock: p.stock }))}
      shows={showDaten}
      kopf={kopf}
    />
  );
}
