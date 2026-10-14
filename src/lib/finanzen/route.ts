// Hilfen für POST-Routen (Datei-Uploads)
import { currentUser, hat } from '../auth';
import type { Rolle } from '../session';

export const json = (d: unknown, status = 200) => Response.json(d, { status });

/** Anmeldung, Rolle und gleiche Herkunft prüfen */
export async function postZugriff(req: Request, ...rollen: Rolle[]) {
  const origin = req.headers.get('origin');
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (origin && host && new URL(origin).host !== host) return { fehler: json({ fehler: 'Ungültige Herkunft' }, 403) } as const;
  const u = await currentUser();
  if (!hat(u, ...rollen)) return { fehler: json({ fehler: 'Keine Berechtigung' }, 403) } as const;
  return { u: u! } as const;
}
