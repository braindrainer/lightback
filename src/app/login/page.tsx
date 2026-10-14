import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';

export const metadata = { title: 'Anmelden' };

const FEHLER: Record<string, string> = {
  falsch: 'Benutzername oder Passwort stimmen nicht.',
  gesperrt: 'Zu viele Fehlversuche. Bitte warten Sie 15 Minuten.',
};

export default async function Login({ searchParams }: { searchParams: Promise<{ fehler?: string; ziel?: string }> }) {
  if (await currentUser()) redirect('/');
  const { fehler, ziel } = await searchParams;
  return (
    <main id="inhalt" className="grid min-h-dvh place-items-center bg-nacht px-4">
      <div className="w-full max-w-sm">
        <p className="mb-6 text-center font-serif text-[28px] tracking-wide text-gold">Light of Creation</p>
        <form action="/api/auth/login" method="post" className="card grid gap-4 p-6" aria-describedby={fehler ? 'fehler' : undefined}>
          <h1 className="h1">Anmelden</h1>
          {fehler && <p id="fehler" role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-neg">{FEHLER[fehler] ?? 'Anmeldung fehlgeschlagen.'}</p>}
          <input type="hidden" name="ziel" value={ziel ?? '/'} />
          <div><label htmlFor="login" className="label">Benutzername oder E-Mail</label><input id="login" name="login" autoComplete="username" required autoFocus className="input" /></div>
          <div><label htmlFor="passwort" className="label">Passwort</label><input id="passwort" name="passwort" type="password" autoComplete="current-password" required className="input" /></div>
          <button className="btn-primary w-full">Anmelden</button>
        </form>
      </div>
    </main>
  );
}
