// Gemeinsame Prüfung für die Export-Routen
import { currentUser, hat } from '../auth';
import { tag } from './zeitraum';

export async function exportZugriff(req: Request) {
  const u = await currentUser();
  if (!hat(u, 'buchhaltung')) return { fehler: new Response('Keine Berechtigung', { status: 403 }) } as const;
  const sp = new URL(req.url).searchParams;
  const von = sp.get('von') ?? '';
  const bis = sp.get('bis') ?? '';
  if (!tag(von) || !tag(bis) || von > bis) return { fehler: new Response('Zeitraum ungültig (von/bis als JJJJ-MM-TT)', { status: 400 }) } as const;
  return { u: u!, von, bis } as const;
}
