import { headers } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { istAppHost, sicheresZiel } from '@/lib/apphost';
import { currentUser } from '@/lib/auth';
import PinAnmeldung from './PinAnmeldung';

export const metadata = { title: 'Anmelden' };

const FEHLER: Record<string, string> = {
  falsch: 'Benutzername oder Passwort stimmen nicht.',
  pin: 'Benutzername oder PIN stimmen nicht – oder für dieses Konto ist keine PIN hinterlegt.',
  gesperrt: 'Zu viele Fehlversuche. Bitte warten Sie 15 Minuten.',
  rolle: 'Mit diesem Konto ist hier kein Zugang möglich. Bitte mit einem Einlass- oder Kassa-Konto anmelden.',
};

// Links Bild der Show, rechts die Anmeldung. Auf der App-Domain (lightapp.*) zuerst die PIN-Anmeldung.
export default async function Login({ searchParams }: { searchParams: Promise<{ fehler?: string; ziel?: string; modus?: string; nutzer?: string }> }) {
  const app = istAppHost(await headers());
  const { fehler, ziel: zielRoh, modus, nutzer } = await searchParams;
  const ziel = sicheresZiel(zielRoh, app ? '/einlass' : '/');
  const u = await currentUser();
  if (u && fehler !== 'rolle') redirect(ziel);
  const pin = modus ? modus === 'pin' : app && fehler !== 'falsch';
  const wechsel = `/login?modus=${pin ? 'passwort' : 'pin'}${zielRoh ? `&ziel=${encodeURIComponent(ziel)}` : ''}`;
  const meldung = fehler && <p id="fehler" role="alert" className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-neg">{FEHLER[fehler] ?? 'Anmeldung fehlgeschlagen.'}</p>;

  return (
    <main id="inhalt" className="grid min-h-dvh lg:grid-cols-[1.15fr_1fr]">
      <section className="relative hidden overflow-hidden bg-nacht lg:block" aria-hidden="true">
        <img src="/img/hero.webp" alt="" className="absolute inset-0 h-full w-full object-cover object-[50%_30%]" />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(7,11,20,.25)_0%,rgba(7,11,20,.35)_55%,rgba(7,11,20,.9)_100%)]" />
        <div className="absolute inset-x-12 bottom-12">
          <img src="/img/logo-wortmarke.svg" alt="" className="h-24 w-auto" />
          <p className="mt-4 max-w-[36ch] text-[15px] text-white/80">Vorstellungen, Verkauf, Kassa, Einlass und Buchhaltung an einem Ort.</p>
        </div>
      </section>

      <section className="flex flex-col justify-between gap-6 bg-white px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))] sm:px-12 sm:py-10">
        <img src="/img/logo-wortmarke.svg" alt="Light of Creation" className="h-11 w-auto self-start brightness-0 sm:h-14 lg:self-end" />
        <div className="mx-auto w-full max-w-sm space-y-5">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{app ? 'Einlass – Anmelden' : 'Anmelden'}</h1>
            <p className="mt-1 text-sm text-muted">{pin ? 'Schnellanmeldung mit Ihrer persönlichen PIN' : 'Backend von Light of Creation'}</p>
          </div>
          {u && fehler === 'rolle' ? (
            <>
              {meldung}
              <p className="text-sm">Angemeldet als <strong>{u.name}</strong>.</p>
              <form action="/api/auth/logout" method="post"><button className="btn-primary min-h-12 w-full text-base">Abmelden und anders anmelden</button></form>
            </>
          ) : pin ? (
            <PinAnmeldung ziel={ziel} nutzer={nutzer ?? ''} fehler={meldung} />
          ) : (
            <form action="/api/auth/login" method="post" className="space-y-5" aria-describedby={fehler ? 'fehler' : undefined}>
              <input type="hidden" name="ziel" value={ziel} />
              <div>
                <label htmlFor="login" className="label">Benutzername oder E-Mail</label>
                <input id="login" name="login" autoComplete="username" autoCapitalize="none" spellCheck={false} required autoFocus className="input min-h-12 !text-base" />
              </div>
              <div>
                <label htmlFor="passwort" className="label">Passwort</label>
                <input id="passwort" name="passwort" type="password" autoComplete="current-password" required className="input min-h-12 !text-base" />
              </div>
              {meldung}
              <button className="btn-primary min-h-12 w-full text-base">Anmelden</button>
            </form>
          )}
          {!(u && fehler === 'rolle') && (
            <p className="text-center text-sm">
              <Link href={wechsel} className="inline-flex min-h-11 items-center px-2 font-medium text-accent-deep underline underline-offset-4">{pin ? 'Mit Passwort anmelden' : 'Mit PIN anmelden'}</Link>
            </p>
          )}
        </div>
        <p className="text-xs text-muted lg:text-right">© {new Date().getFullYear()} Parnassus Immersive GmbH</p>
      </section>
    </main>
  );
}
