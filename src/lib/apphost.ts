// Eigene Domain für die Vor-Ort-App (lightapp.skillful.at): gleiche Anwendung, Weiche über den Host.
// Ohne Abhängigkeiten, damit es auch in der Middleware (Edge) läuft.
export const APP_PRAEFIX = 'lightapp.';

type Kopf = { get(name: string): string | null };

/** Host der Anfrage: X-Forwarded-Host (falls ein Proxy ihn setzt), sonst Host */
export function hostAus(h: Kopf): string {
  return (h.get('x-forwarded-host')?.split(',')[0] ?? h.get('host') ?? '').trim().toLowerCase();
}

export const istAppHost = (h: Kopf) => hostAus(h).startsWith(APP_PRAEFIX);

/** Interne Ziele nach der Anmeldung: nur relative Pfade dieser Anwendung */
export const sicheresZiel = (z: unknown, ersatz = '/') => (typeof z === 'string' && z.startsWith('/') && !z.startsWith('//') && !z.startsWith('/\\') ? z : ersatz);
