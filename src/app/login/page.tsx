import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';

export const metadata = { title: 'Anmelden' };

const FEHLER: Record<string, string> = {
  falsch: 'Benutzername oder Passwort stimmen nicht.',
  gesperrt: 'Zu viele Fehlversuche. Bitte warten Sie 15 Minuten.',
};

// Links Bild der Show, rechts die Anmeldung (wie in skillfinance)
export default async function Login({ searchParams }: { searchParams: Promise<{ fehler?: string; ziel?: string }> }) {
  if (await currentUser()) redirect('/');
  const { fehler, ziel } = await searchParams;
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

      <section className="flex flex-col justify-between bg-white px-6 py-10 sm:px-12">
        <img src="/img/logo-wortmarke.svg" alt="Light of Creation" className="h-14 w-auto self-start brightness-0 lg:self-end" />
        <form action="/api/auth/login" method="post" className="mx-auto w-full max-w-sm space-y-5 py-12" aria-describedby={fehler ? 'fehler' : undefined}>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Anmelden</h1>
            <p className="mt-1 text-sm text-muted">Backend von Light of Creation</p>
          </div>
          <input type="hidden" name="ziel" value={ziel ?? '/'} />
          <div>
            <label htmlFor="login" className="label">Benutzername oder E-Mail</label>
            <input id="login" name="login" autoComplete="username" autoCapitalize="none" spellCheck={false} required autoFocus className="input !py-2.5" />
          </div>
          <div>
            <label htmlFor="passwort" className="label">Passwort</label>
            <input id="passwort" name="passwort" type="password" autoComplete="current-password" required className="input !py-2.5" />
          </div>
          {fehler && <p id="fehler" role="alert" className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-neg">{FEHLER[fehler] ?? 'Anmeldung fehlgeschlagen.'}</p>}
          <button className="btn-primary w-full !py-2.5">Anmelden</button>
        </form>
        <p className="text-xs text-muted lg:text-right">© {new Date().getFullYear()} Parnassus Immersive GmbH</p>
      </section>
    </main>
  );
}
