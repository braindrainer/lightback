import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { db } from '@/lib/db';
import { fmtDatumZeit } from '@/lib/dates';
import { KATEGORIEN } from '@/lib/kassa-shared';
import { formatNumber } from '@/lib/money';
import { kasseAnlegenAction, produktSpeichernAction, signaturAction, sonderbelegAction } from '../actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Einrichtung' };

const SAETZE = [20, 13, 10, 0];

function Produktformular({ p }: { p?: { id: string; name: string; category: string; priceCents: number; vatRate: number; sku: string | null; stock: number | null; sort: number; color: string; active: boolean } }) {
  const k = p?.id ?? 'neu';
  return (
    <form action={produktSpeichernAction} className="grid grid-cols-2 gap-2 border-t border-line p-3 sm:grid-cols-[2fr_1.2fr_1fr_.8fr_.8fr_.8fr_.6fr_.9fr_auto_auto] sm:items-end">
      {p && <input type="hidden" name="id" value={p.id} />}
      <div className="col-span-2 sm:col-span-1"><label htmlFor={`n-${k}`} className="label">Name</label><input id={`n-${k}`} name="name" defaultValue={p?.name} required className="input min-h-12" /></div>
      <div><label htmlFor={`c-${k}`} className="label">Kategorie</label><select id={`c-${k}`} name="category" defaultValue={p?.category ?? 'merch'} className="input min-h-12">{KATEGORIEN.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select></div>
      <div><label htmlFor={`p-${k}`} className="label">Preis €</label><input id={`p-${k}`} name="preis" inputMode="decimal" defaultValue={p ? formatNumber(p.priceCents / 100) : ''} required className="input min-h-12" /></div>
      <div><label htmlFor={`v-${k}`} className="label">USt</label><select id={`v-${k}`} name="vatRate" defaultValue={p?.vatRate ?? 20} className="input min-h-12">{SAETZE.map((s) => <option key={s} value={s}>{s} %</option>)}</select></div>
      <div><label htmlFor={`s-${k}`} className="label">SKU</label><input id={`s-${k}`} name="sku" defaultValue={p?.sku ?? ''} className="input min-h-12" /></div>
      <div><label htmlFor={`b-${k}`} className="label">Bestand</label><input id={`b-${k}`} name="stock" inputMode="numeric" defaultValue={p?.stock ?? ''} className="input min-h-12" /></div>
      <div><label htmlFor={`o-${k}`} className="label">Reihung</label><input id={`o-${k}`} name="sort" inputMode="numeric" defaultValue={p?.sort ?? 0} className="input min-h-12" /></div>
      <div><label htmlFor={`f-${k}`} className="label">Farbe</label><input id={`f-${k}`} name="color" defaultValue={p?.color ?? ''} placeholder="#d9b877" className="input min-h-12" /></div>
      <label className="inline-flex min-h-12 items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={p?.active ?? true} className="size-5" /> aktiv</label>
      <button className="btn-primary min-h-12">{p ? 'Speichern' : 'Anlegen'}</button>
    </form>
  );
}

export default async function Einrichtung({ searchParams }: { searchParams: Promise<{ meldung?: string; fehler?: string }> }) {
  await requireRole('admin');
  const { meldung, fehler } = await searchParams;
  const [kassen, produkte] = await Promise.all([
    db.register.findMany({ orderBy: { createdAt: 'asc' } }),
    db.product.findMany({ orderBy: [{ active: 'desc' }, { sort: 'asc' }, { name: 'asc' }] }),
  ]);
  return (
    <div className="mx-auto grid w-full max-w-6xl gap-6 px-3 py-5 sm:px-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="h1">Kassa-Einrichtung</h1>
        <Link href="/kassa/kassenbuch" className="btn-secondary min-h-12">Kassenbuch</Link>
      </div>
      {meldung && <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-base text-emerald-950">{meldung}</p>}
      {fehler && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-base text-neg">{fehler}</p>}

      <section aria-labelledby="kassen" className="grid gap-4">
        <h2 id="kassen" className="h2 text-lg">Registrierkassen</h2>
        {kassen.map((k) => {
          const c = (k.signerConfig ?? {}) as { apiKey?: string; tssId?: string; apiSecretEnc?: string };
          return (
            <article key={k.id} className="card grid gap-4 p-4" aria-labelledby={`k-${k.id}`}>
              <div className="flex flex-wrap items-baseline gap-3">
                <h3 id={`k-${k.id}`} className="text-base font-semibold">{k.name}</h3>
                <span className="font-mono text-sm">{k.kassenId}</span>
                <span className={`pill ${k.active ? 'bg-emerald-50 text-emerald-900' : 'bg-gray-100 text-gray-700'}`}>{k.active ? 'in Betrieb' : 'außer Betrieb'}</span>
                <span className="text-sm text-muted">{k.startedAt ? `Startbeleg ${fmtDatumZeit(k.startedAt)}` : 'Startbeleg fehlt'} · letzter Beleg Nr. {k.lastReceiptNo}</span>
              </div>
              {k.active && (
                <div className="flex flex-wrap gap-2">
                  {!k.startedAt ? (
                    <form action={sonderbelegAction}><input type="hidden" name="registerId" value={k.id} /><input type="hidden" name="typ" value="start" /><button className="btn-gold min-h-12">Startbeleg erstellen</button></form>
                  ) : (
                    <>
                      {(['null', 'monat', 'jahr'] as const).map((t) => (
                        <form key={t} action={sonderbelegAction}><input type="hidden" name="registerId" value={k.id} /><input type="hidden" name="typ" value={t} /><button className="btn-secondary min-h-12">{t === 'null' ? 'Nullbeleg' : t === 'monat' ? 'Monatsbeleg' : 'Jahresbeleg'}</button></form>
                      ))}
                    </>
                  )}
                  <a href={`/api/kassa/dep?registerId=${k.id}`} className="btn-secondary min-h-12">DEP-Export (JSON)</a>
                </div>
              )}
              {!k.active && <a href={`/api/kassa/dep?registerId=${k.id}`} className="btn-secondary min-h-12 w-fit">DEP-Export (JSON)</a>}
              {k.active && (
                <details className="rounded-lg border border-line p-3">
                  <summary className="min-h-8 cursor-pointer text-sm font-semibold">Signatureinheit</summary>
                  <form action={signaturAction} className="mt-3 grid gap-3 sm:grid-cols-2">
                    <input type="hidden" name="registerId" value={k.id} />
                    <div><label htmlFor={`sg-${k.id}`} className="label">Verfahren</label><select id={`sg-${k.id}`} name="signer" defaultValue={k.signer} className="input min-h-12"><option value="demo">Demo (ECDSA, nicht rechtsgültig)</option><option value="fiskaly">fiskaly SIGN AT</option></select></div>
                    <div><label htmlFor={`cs-${k.id}`} className="label">Zertifikat-Seriennummer (fiskaly)</label><input id={`cs-${k.id}`} name="certSerial" defaultValue={k.signer === 'fiskaly' ? k.certSerial : ''} className="input min-h-12" /></div>
                    <div><label htmlFor={`ak-${k.id}`} className="label">fiskaly API-Key</label><input id={`ak-${k.id}`} name="apiKey" defaultValue={c.apiKey ?? ''} autoComplete="off" className="input min-h-12" /></div>
                    <div><label htmlFor={`as-${k.id}`} className="label">fiskaly API-Secret {c.apiSecretEnc ? '(gespeichert)' : ''}</label><input id={`as-${k.id}`} name="apiSecret" type="password" autoComplete="new-password" className="input min-h-12" /></div>
                    <div><label htmlFor={`ts-${k.id}`} className="label">fiskaly SCU/TSS-ID</label><input id={`ts-${k.id}`} name="tssId" defaultValue={c.tssId ?? ''} className="input min-h-12" /></div>
                    <p className="text-sm text-muted sm:col-span-2">fiskaly ist noch nicht angebunden – Belege werden dann mit „Sicherheitseinrichtung ausgefallen“ erstellt. Ausfälle über 48 Stunden sind über FinanzOnline zu melden.</p>
                    <button className="btn-primary min-h-12 w-fit">Speichern</button>
                  </form>
                </details>
              )}
              {k.active && k.startedAt && (
                <details className="rounded-lg border border-red-200 p-3">
                  <summary className="min-h-8 cursor-pointer text-sm font-semibold text-neg">Kasse außer Betrieb nehmen (Schlussbeleg)</summary>
                  <form action={sonderbelegAction} className="mt-3 grid gap-3">
                    <input type="hidden" name="registerId" value={k.id} /><input type="hidden" name="typ" value="schluss" />
                    <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" name="bestaetigt" value="ja" className="size-5" /> Ich bestätige: Diese Kasse wird endgültig außer Betrieb genommen.</label>
                    <button className="btn-danger min-h-12 w-fit">Schlussbeleg erstellen</button>
                  </form>
                </details>
              )}
            </article>
          );
        })}
        <form action={kasseAnlegenAction} className="card grid gap-3 p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <h3 className="text-base font-semibold sm:col-span-3">Neue Kasse</h3>
          <div><label htmlFor="kname" className="label">Bezeichnung</label><input id="kname" name="name" required className="input min-h-12" placeholder="Kassa Shop" /></div>
          <div><label htmlFor="kid" className="label">Kassen-ID (wie bei FinanzOnline)</label><input id="kid" name="kassenId" required pattern="[A-Za-z0-9\-]{3,30}" className="input min-h-12" placeholder="LOC-KASSA-2" /></div>
          <button className="btn-primary min-h-12">Anlegen</button>
        </form>
      </section>

      <section aria-labelledby="artikel" className="card">
        <h2 id="artikel" className="h2 px-4 pt-4 text-lg">Artikel</h2>
        <p className="px-4 pb-2 text-sm text-muted">Abendkasse: Kategorie „Abendkasse“, Kategorie im Namen oder als SKU (I, II, R; ermäßigt mit „ermäßigt“). Der Preis kommt aus der Vorstellung. Wertgutscheine: Kategorie „Gutscheine &amp; Sonstiges“ mit „Gutschein“ im Namen, 0 %.</p>
        {produkte.map((p) => <Produktformular key={p.id} p={p} />)}
        <h3 className="px-4 pt-4 text-base font-semibold">Neuer Artikel</h3>
        <Produktformular />
      </section>
    </div>
  );
}
