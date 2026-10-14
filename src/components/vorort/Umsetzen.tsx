'use client';
// Ticket umsetzen (anderer Platz) bzw. Tarif ändern. Ein neuer Platz wird im Saalplan gewählt,
// der Preisunterschied nach den Listenpreisen angezeigt. Kassa: Aufpreis gleich kassieren.
import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';
import { formatEur, parseAmountToCents } from '@/lib/money';
import { preis, SITZ, sitzName, type Kat, type Preise } from '@/lib/saal';
import type { Status } from '@/lib/seats';
import Saalplan from '@/components/verkauf/Saalplan';
import type { Ergebnis } from '@/components/verkauf/ergebnis';
import { Meldung } from '@/components/verkauf/form';

export type UmsetzenEingabe = {
  seatId?: string; art?: 'normal' | 'ermaessigt'; ausgleich: 'keine' | 'gutschein'; kulanz: boolean; grund: string;
  payment?: 'bar' | 'karte'; givenCents?: number | null;
};
type Ticket = { id: string; seatId: string; kat: string; art: string; code: string };

export default function Umsetzen({ ticket, status, preise, modus, darfKulanz, action, nachher }: {
  ticket: Ticket; status: Record<string, Status>; preise: Preise;
  /** kassa: Aufpreis wird kassiert; backend: Kulanz (Leitung) oder Verweis an die Kassa; einlass: nur ohne Aufpreis */
  modus: 'kassa' | 'backend' | 'einlass';
  darfKulanz: boolean;
  action: (e: UmsetzenEingabe) => Promise<Ergebnis>;
  /** Ziel nach Erfolg (z. B. Belegdruck); $beleg wird durch die Beleg-ID ersetzt */
  nachher?: string;
}) {
  const id = useId();
  const router = useRouter();
  const [seat, setSeat] = useState<string | null>(null);
  const zielKat = (seat ? SITZ[seat].kat : ticket.kat) as Kat;
  const tarifWaehlbar = ticket.art !== 'frei' && zielKat !== 'R';
  const [art, setArt] = useState<'normal' | 'ermaessigt'>(ticket.art === 'ermaessigt' ? 'ermaessigt' : 'normal');
  const [ausgleich, setAusgleich] = useState<'keine' | 'gutschein'>('keine');
  const [kulanz, setKulanz] = useState(false);
  const [payment, setPayment] = useState<'bar' | 'karte'>('bar');
  const [gegeben, setGegeben] = useState('');
  const [grund, setGrund] = useState('');
  const [e, setE] = useState<Ergebnis>();
  const [laeuft, start] = useTransition();

  const zielArt = ticket.art === 'frei' ? 'frei' : zielKat === 'R' ? 'rollstuhl' : art;
  const diff = preis(preise, zielKat, zielArt) - preis(preise, ticket.kat as Kat, ticket.art);
  const aenderung = !!seat || zielArt !== ticket.art;
  const gesperrt = !aenderung || (diff > 0 && modus === 'einlass') || (diff > 0 && modus === 'backend' && !kulanz);

  function senden(ev: React.FormEvent) {
    ev.preventDefault();
    if (gesperrt) return;
    start(async () => {
      const r = await action({
        seatId: seat ?? undefined, art: tarifWaehlbar ? art : undefined, ausgleich, kulanz, grund,
        ...(modus === 'kassa' && diff > 0 ? { payment, givenCents: payment === 'bar' && gegeben.trim() ? parseAmountToCents(gegeben) : null } : {}),
      });
      setE(r);
      if (!r.fehler) {
        setSeat(null);
        const beleg = r.daten?.beleg as string | undefined;
        if (nachher && (beleg || !nachher.includes('$beleg'))) router.push(nachher.replace('$beleg', beleg ?? ''));
        else router.refresh();
      }
    });
  }

  return (
    <form onSubmit={senden} className="grid gap-4">
      <p className="text-sm">
        Jetzt: <strong>{sitzName(ticket.seatId)}</strong> ({ticket.kat === 'R' ? 'Rollstuhlplatz' : `Kategorie ${ticket.kat}`}, {ticket.art === 'ermaessigt' ? 'ermäßigt' : ticket.art === 'frei' ? 'Freikarte' : ticket.art === 'rollstuhl' ? 'Rollstuhl' : 'Vollpreis'}).
        {' '}Wählen Sie einen freien Platz im Plan{tarifWaehlbar ? ' und/oder einen anderen Tarif' : ''}.
      </p>
      <div className="rounded-xl bg-white p-2 text-ink">
        <Saalplan status={status} modus="auswahl" auswahl={seat ? [seat] : []} onAuswahl={(ids) => setSeat(ids.filter((x) => x !== seat).at(-1) ?? null)} titel="Saalplan, neuen Platz wählen" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <p className="text-base" aria-live="polite">Neuer Platz: <strong>{seat ? sitzName(seat) : 'unverändert'}</strong></p>
        {tarifWaehlbar && (
          <div>
            <label htmlFor={`${id}-art`} className="label">Tarif</label>
            <select id={`${id}-art`} className="input" value={art} onChange={(x) => setArt(x.target.value as 'normal' | 'ermaessigt')}>
              <option value="normal">Vollpreis</option>
              <option value="ermaessigt">Ermäßigt</option>
            </select>
          </div>
        )}
      </div>
      <p role="status" className={`rounded-lg px-3 py-2 text-base ${diff > 0 ? 'bg-amber-50 text-warn' : 'bg-paper text-ink'}`}>
        {!aenderung ? 'Noch keine Änderung gewählt.' : diff > 0 ? `Aufpreis: ${formatEur(diff)}` : diff < 0 ? `Günstiger um ${formatEur(-diff)}` : 'Kein Preisunterschied.'}
      </p>
      {aenderung && diff > 0 && modus === 'kassa' && (
        <fieldset className="grid gap-2">
          <legend className="label">Aufpreis kassieren</legend>
          <div className="flex flex-wrap gap-4">
            {(['bar', 'karte'] as const).map((z) => (
              <label key={z} className="flex min-h-11 items-center gap-2 text-base"><input type="radio" name={`${id}-z`} checked={payment === z} onChange={() => setPayment(z)} className="size-5 accent-accent" />{z === 'bar' ? 'Bar' : 'Karte (Terminal)'}</label>
            ))}
          </div>
          {payment === 'bar' && (
            <div className="max-w-56"><label htmlFor={`${id}-g`} className="label">Gegeben (€, leer = passend)</label><input id={`${id}-g`} inputMode="decimal" value={gegeben} onChange={(x) => setGegeben(x.target.value)} className="input" /></div>
          )}
        </fieldset>
      )}
      {aenderung && diff > 0 && modus === 'backend' && (darfKulanz
        ? <label className="flex min-h-11 items-center gap-2 text-base"><input type="checkbox" checked={kulanz} onChange={(x) => setKulanz(x.target.checked)} className="size-5 accent-accent" />Ohne Aufpreis (Kulanz)</label>
        : <p className="text-sm">Den Aufpreis bitte an der Kassa kassieren (Kassa → Gäste &amp; Tickets).</p>)}
      {aenderung && diff > 0 && modus === 'einlass' && <p className="text-base font-semibold">Mit Aufpreis nur an der Kassa möglich.</p>}
      {aenderung && diff < 0 && modus !== 'einlass' && (
        <fieldset>
          <legend className="label">Ausgleich</legend>
          <div className="flex flex-wrap gap-4">
            <label className="flex min-h-11 items-center gap-2 text-base"><input type="radio" name={`${id}-a`} checked={ausgleich === 'keine'} onChange={() => setAusgleich('keine')} className="size-5 accent-accent" />Kein Ausgleich</label>
            <label className="flex min-h-11 items-center gap-2 text-base"><input type="radio" name={`${id}-a`} checked={ausgleich === 'gutschein'} onChange={() => setAusgleich('gutschein')} className="size-5 accent-accent" />Gutschein über {formatEur(-diff)}</label>
          </div>
        </fieldset>
      )}
      <div><label htmlFor={`${id}-grund`} className="label">Grund (optional, z. B. Sicht, Gruppe zusammen)</label><input id={`${id}-grund`} value={grund} onChange={(x) => setGrund(x.target.value)} maxLength={200} className="input" /></div>
      <div><button type="submit" className="btn-primary min-h-12" disabled={gesperrt || laeuft} aria-disabled={gesperrt || laeuft}>{laeuft ? 'Bitte warten …' : diff > 0 && modus === 'kassa' ? `${formatEur(diff)} kassieren und umsetzen` : 'Änderung speichern'}</button></div>
      <Meldung e={e} />
    </form>
  );
}
