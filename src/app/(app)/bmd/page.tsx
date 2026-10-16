import { requireRole, hat } from '@/lib/auth';
import { db, getSettings } from '@/lib/db';
import { fmtDatum, fmtDatumZeit } from '@/lib/dates';
import { offeneBuchungen, STATUS_NAME } from '@/lib/finanzen/bmd-uebergabe';
import { tagStr } from '@/lib/finanzen/zeitraum';
import { requireModul } from '@/lib/module';
import { Formular } from '@/components/system/Formular';
import { Abschnitt, Kennzahlen, LeerZustand, PageHeader, StatusPill } from '@/components/ui';
import { bmdMailSpeichern, konnektorSchluessel, laufJetzt, rueckmeldungErfassen } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'BMD-Übergabe' };

const TON: Record<string, string> = { bereit: 'offen', abgeholt: 'teilstorniert', uebernommen: 'bezahlt', fehler: 'storniert' };

export default async function BmdSeite() {
  const u = await requireRole('buchhaltung');
  await requireModul('bmd');
  const [s, offen, laeufe] = await Promise.all([
    getSettings(),
    offeneBuchungen(),
    db.bmdLauf.findMany({ orderBy: { nummer: 'desc' }, take: 50, select: { id: true, nummer: true, bis: true, anzahl: true, zeilen: true, sollCents: true, status: true, quelle: true, bmdReferenz: true, fehler: true, createdAt: true, abgeholtAt: true, abgeholtVon: true, rueckmeldungAt: true, sha256: true } }),
  ]);
  const warten = laeufe.filter((l) => l.status === 'bereit' || l.status === 'abgeholt');
  const letzte = laeufe.find((l) => l.status === 'uebernommen');
  const app = (process.env.APP_ORIGIN ?? 'https://lightback.skillful.at').replace(/\/$/, '');
  const heute = tagStr(new Date());
  return (
    <>
      <PageHeader krumen={[{ label: 'Finanzen' }, { label: 'BMD-Übergabe' }]} title="BMD-Übergabe"
        sub="BMD NTCS bleibt das führende Buchhaltungssystem. Jede Buchung aus Lightback geht genau einmal in einem Lauf an BMD; BMD meldet zurück, ob der Import geklappt hat." />
      <Kennzahlen items={[
        { label: 'Noch nicht übergeben', wert: String(offen.length), hinweis: offen.length ? `ab ${fmtDatum(offen[0].date)}` : 'alles übergeben', ton: offen.length ? 'warn' : 'pos' },
        { label: 'Wartet auf Rückmeldung', wert: String(warten.length), hinweis: warten.length ? `ältester Lauf ${warten[warten.length - 1].nummer}` : 'keiner', ton: warten.length ? 'warn' : undefined },
        { label: 'Zuletzt übernommen', wert: letzte ? `Lauf ${letzte.nummer}` : '–', hinweis: letzte ? `Buchungen bis ${fmtDatum(letzte.bis)}${letzte.bmdReferenz ? ` · ${letzte.bmdReferenz}` : ''}` : undefined },
        { label: 'Konnektor', wert: s.bmdKeyHash ? 'eingerichtet' : 'kein Schlüssel', hinweis: s.bmdKeyPrefix ? `${s.bmdKeyPrefix}…` : 'Download oder Mail möglich' },
      ]} />

      <div className="grid gap-6">
        <Abschnitt id="laeufe" titel="Läufe" beschreibung="Automatisch jede Nacht nach 2 Uhr mit allen Buchungen bis zum Vortag. Fehlerhafte Läufe gehen beim nächsten Lauf neu hinaus." flush tabelleFrei>
          {laeufe.length === 0 ? <div className="px-5 pb-5"><LeerZustand kompakt titel="Noch kein Lauf">Der erste Lauf entsteht heute Nacht oder über „Lauf jetzt erstellen“.</LeerZustand></div> : (
            <table className="table rtab">
              <thead className="rtab-kopf"><tr><th scope="col">Lauf</th><th scope="col">Buchungen bis</th><th scope="col" className="text-right">Buchungen</th><th scope="col">Status</th><th scope="col">BMD-Referenz / Fehler</th><th scope="col">Erstellt</th><th scope="col"><span className="sr-only">Datei</span></th></tr></thead>
              <tbody>
                {laeufe.map((l) => (
                  <tr key={l.id}>
                    <td data-label="Lauf" className="font-mono">{l.nummer}<span className="ml-2 text-xs text-muted">{l.quelle}</span></td>
                    <td data-label="Buchungen bis">{fmtDatum(l.bis)}</td>
                    <td data-label="Buchungen" className="num text-right">{l.anzahl}<span className="block text-xs text-muted">{l.zeilen} Zeilen</span></td>
                    <td data-label="Status"><StatusPill status={TON[l.status] ?? 'offen'} label={STATUS_NAME[l.status] ?? l.status} />{l.abgeholtAt && <span className="mt-1 block text-xs text-muted">abgeholt {fmtDatumZeit(l.abgeholtAt)}{l.abgeholtVon ? ` · ${l.abgeholtVon}` : ''}</span>}</td>
                    <td data-label="BMD-Referenz / Fehler" className="max-w-[28ch] text-sm">{l.bmdReferenz ?? ''}{l.fehler && <span className="text-neg">{l.fehler}</span>}{l.rueckmeldungAt && <span className="block text-xs text-muted">{fmtDatumZeit(l.rueckmeldungAt)}</span>}</td>
                    <td data-label="Erstellt" className="text-sm">{fmtDatumZeit(l.createdAt)}<span className="block font-mono text-[11px] text-muted" title="SHA-256 der Datei">{l.sha256.slice(0, 12)}…</span></td>
                    <td data-label="Datei"><a href={`/bmd/${l.nummer}/datei`} className="link">CSV<span className="sr-only"> von Lauf {l.nummer}</span></a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Abschnitt>

        <div className="grid gap-6 lg:grid-cols-2">
          <Formular action={laufJetzt} knopf="Lauf jetzt erstellen" className="card p-5">
            <h2 className="h2">Lauf jetzt erstellen</h2>
            <p className="mt-1 mb-3 text-sm text-muted">Für einen Monatsabschluss oder vor der UVA: alle noch nicht übergebenen Buchungen bis zu diesem Tag.</p>
            <label htmlFor="bis" className="label">Buchungen bis einschließlich</label>
            <input id="bis" name="bis" type="date" defaultValue={heute} max={heute} required className="input max-w-48" />
          </Formular>

          <Formular action={rueckmeldungErfassen} knopf="Rückmeldung speichern" className="card p-5" zuruecksetzen>
            <h2 className="h2">Rückmeldung von Hand</h2>
            <p className="mt-1 mb-3 text-sm text-muted">Wenn die Datei per Download oder Mail importiert wurde. Mit Konnektor kommt die Rückmeldung automatisch.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="nummer" className="label">Lauf</label>
                <select id="nummer" name="nummer" className="input" required defaultValue={warten[warten.length - 1]?.nummer ?? ''}>
                  {warten.length === 0 && <option value="">kein offener Lauf</option>}
                  {[...warten].reverse().map((l) => <option key={l.id} value={l.nummer}>Lauf {l.nummer} – bis {fmtDatum(l.bis)}</option>)}
                </select>
              </div>
              <fieldset>
                <legend className="label">Ergebnis</legend>
                <label className="flex min-h-8 items-center gap-2 text-sm"><input type="radio" name="ok" value="ja" className="h-4 w-4 accent-[#6e5118]" /> in BMD übernommen</label>
                <label className="flex min-h-8 items-center gap-2 text-sm"><input type="radio" name="ok" value="nein" className="h-4 w-4 accent-[#6e5118]" /> Fehler beim Import</label>
              </fieldset>
              <div><label htmlFor="referenz" className="label">BMD-Referenz (z. B. Stapel-Nr.)</label><input id="referenz" name="referenz" className="input" maxLength={100} /></div>
              <div><label htmlFor="fehler" className="label">Fehler laut Importprotokoll</label><input id="fehler" name="fehler" className="input" maxLength={2000} /></div>
            </div>
          </Formular>
        </div>

        <Abschnitt id="konnektor" titel="BMD-Konnektor" beschreibung="Kleines Programm im Netz des Veranstalters neben BMD: holt neue Läufe ab, legt sie in den Importordner von BMD NTCS und meldet das Ergebnis zurück.">
          <ol className="grid list-decimal gap-1.5 pl-5 text-sm">
            <li><code className="font-mono">GET {app}/api/bmd/v1/laeufe</code> – Läufe mit Status „bereit“ (JSON, älteste zuerst)</li>
            <li><code className="font-mono">GET {app}/api/bmd/v1/laeufe/&#123;nummer&#125;/datei</code> – Importdatei (CSV, ISO-8859-1, Prüfsumme im Kopf <code>X-Sha256</code>), Status wird „abgeholt“</li>
            <li><code className="font-mono">POST {app}/api/bmd/v1/laeufe/&#123;nummer&#125;/rueckmeldung</code> mit <code className="font-mono">{'{"ok":true,"referenz":"Stapel 2026-118"}'}</code> oder <code className="font-mono">{'{"ok":false,"fehler":"…"}'}</code></li>
          </ol>
          <p className="mt-2 text-sm text-muted">Anmeldung mit <code className="font-mono">Authorization: Bearer loc_bmd_…</code>. Jede Abholung und Rückmeldung steht im Protokoll.</p>
          {hat(u, 'einstellungen') && (
            <Formular action={konnektorSchluessel} knopf={s.bmdKeyHash ? 'Neuen Schlüssel erstellen' : 'Schlüssel erstellen'} variante="btn-secondary" bestaetigen={s.bmdKeyHash ? 'Der bisherige Schlüssel wird sofort ungültig. Fortfahren?' : undefined} className="mt-4">
              <p className="text-sm">{s.bmdKeyHash ? <>Aktueller Schlüssel beginnt mit <code className="font-mono">{s.bmdKeyPrefix}…</code></> : 'Noch kein Schlüssel.'}</p>
            </Formular>
          )}
        </Abschnitt>

        {hat(u, 'einstellungen') && (
          <Formular action={bmdMailSpeichern} knopf="Speichern" className="card p-5">
            <h2 className="h2">Kopie per E-Mail</h2>
            <p className="mt-1 mb-3 text-sm text-muted">Ohne Konnektor: jeder Lauf geht als Anhang an diese Adresse, z. B. an die Steuerberatung. Leer = kein Versand.</p>
            <label htmlFor="bmdMail" className="label">E-Mail-Adresse</label>
            <input id="bmdMail" name="bmdMail" type="email" defaultValue={s.bmdMail} className="input max-w-md" autoComplete="off" />
          </Formular>
        )}
      </div>
    </>
  );
}
