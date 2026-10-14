// Gemeinsames für die JSON-APIs (Shop und Partner): Fehlerformat, CORS, Rate-Limit, Validierung.
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { erlaubt } from './ratelimit';
import { PlatzBelegt } from './seats';

export class ApiFehler extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
}

export const clientIp = (req: Request) => req.headers.get('x-real-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'lokal';

export function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });
}

export const fehler = (status: number, code: string, message: string, details?: unknown) => json({ error: { code, message, ...(details ? { details } : {}) } }, status);

/** Fehler einheitlich übersetzen. Fachliche Fehler der Kernlogik (Error mit Text) → 422 mit Text. */
export function fehlerAntwort(e: unknown): Response {
  if (e instanceof ApiFehler) {
    const r = fehler(e.status, e.code, e.message, e.details);
    if (e.status === 429) r.headers.set('Retry-After', String((e.details as { retryAfter?: number })?.retryAfter ?? 60));
    return r;
  }
  if (e instanceof z.ZodError) return fehler(400, 'ungueltig', 'Ungültige Eingabe', e.issues.map((i) => ({ pfad: i.path.join('.'), meldung: i.message })));
  if (e instanceof PlatzBelegt) return fehler(409, 'platz_belegt', 'Mindestens ein Platz ist nicht mehr frei', { seats: e.seats });
  if (e instanceof Prisma.PrismaClientKnownRequestError || e instanceof Prisma.PrismaClientValidationError || e instanceof Prisma.PrismaClientUnknownRequestError) {
    console.error('API', e);
    return fehler(500, 'intern', 'Interner Fehler');
  }
  if (e instanceof Error) return fehler(422, 'abgelehnt', e.message);
  console.error('API', e);
  return fehler(500, 'intern', 'Interner Fehler');
}

export async function koerper<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  let roh: unknown;
  try {
    const t = await req.text();
    roh = t ? JSON.parse(t) : {};
  } catch {
    throw new ApiFehler(400, 'json', 'Der Body ist kein gültiges JSON');
  }
  return schema.parse(roh);
}

export function begrenzen(key: string, limit: number) {
  const r = erlaubt(key, limit);
  if (!r.ok) throw new ApiFehler(429, 'zu_viele_anfragen', `Zu viele Anfragen – bitte in ${r.retryAfter} Sekunden erneut versuchen`, { retryAfter: r.retryAfter });
}

// ───────── Shop-API (CORS nur für PUBLIC_ORIGIN) ─────────
const herkunft = () => (process.env.PUBLIC_ORIGIN ?? '').replace(/\/$/, '');

export function corsKopf(req: Request): Record<string, string> {
  const o = req.headers.get('origin');
  const h: Record<string, string> = { Vary: 'Origin' };
  if (o && herkunft() && o === herkunft()) {
    h['Access-Control-Allow-Origin'] = o;
    h['Access-Control-Allow-Methods'] = 'GET, POST, PATCH, DELETE, OPTIONS';
    h['Access-Control-Allow-Headers'] = 'Content-Type, X-Hold-Token, If-None-Match';
    h['Access-Control-Expose-Headers'] = 'ETag, Retry-After';
    h['Access-Control-Max-Age'] = '600';
  }
  return h;
}

export const preflight = (req: Request) => new Response(null, { status: 204, headers: corsKopf(req) });

type Ctx<P> = { params: Promise<P> };

/** Route der Shop-API: Rate-Limit je IP, CORS, Fehlerformat */
export function shopRoute<P = Record<string, never>>(handler: (req: Request, params: P) => Promise<Response>, limit = 120) {
  return async (req: Request, ctx: Ctx<P>) => {
    let res: Response;
    try {
      begrenzen(`shop:${clientIp(req)}:${limit}`, limit);
      res = await handler(req, await ctx.params);
    } catch (e) {
      res = fehlerAntwort(e);
    }
    for (const [k, v] of Object.entries(corsKopf(req))) res.headers.set(k, v);
    return res;
  };
}

/** Antwort mit ETag; bei passendem If-None-Match 304 ohne Body */
export function jsonMitEtag(req: Request, etag: string, daten: unknown, cacheControl = 'no-cache') {
  const kopf = { ETag: etag, 'Cache-Control': cacheControl };
  const inm = req.headers.get('if-none-match');
  if (inm && inm.split(',').map((x) => x.trim().replace(/^W\//, '')).includes(etag)) return new Response(null, { status: 304, headers: kopf });
  return json(daten, 200, kopf);
}

/** Schreibende Reservierungs-Anfragen: 60 je Minute und IP */
export const holdLimit = (req: Request) => begrenzen(`hold-mut:${clientIp(req)}`, 60);

export const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

// ───────── Gemeinsame Eingaben ─────────
const tagRe = /^\d{4}-\d{2}-\d{2}$/;

/** ?from&to als Tag (YYYY-MM-DD, Wiener Zeit) oder ISO-Zeitpunkt; Standard: ab jetzt 90 Tage, max. 186 Tage */
export function zeitraum(url: URL, wienZuUtc: (d: string, z: string) => Date) {
  const lies = (v: string | null, ende: boolean) => {
    if (!v) return null;
    if (tagRe.test(v)) return ende ? new Date(wienZuUtc(v, '00:00').getTime() + 864e5 - 1) : wienZuUtc(v, '00:00');
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) throw new ApiFehler(400, 'ungueltig', `Ungültiges Datum: ${v}`);
    return d;
  };
  const from = lies(url.searchParams.get('from'), false) ?? new Date();
  const to = lies(url.searchParams.get('to'), true) ?? new Date(from.getTime() + 90 * 864e5);
  if (to < from) throw new ApiFehler(400, 'ungueltig', '"to" liegt vor "from"');
  if (to.getTime() - from.getTime() > 186 * 864e5) throw new ApiFehler(400, 'ungueltig', 'Zeitraum höchstens 186 Tage');
  return { from, to };
}

export const sitzSchema = z.object({ seatId: z.string().min(1).max(10), art: z.enum(['normal', 'ermaessigt']).default('normal') });
export const holdSchema = z.object({ showId: z.string().min(1).max(40), seats: z.array(sitzSchema).min(1).max(10) });
export const bestSchema = z.object({
  showId: z.string().min(1).max(40), anzahl: z.number().int().min(1).max(10), kat: z.enum(['I', 'II', 'R']), art: z.enum(['normal', 'ermaessigt']).optional(),
  wunsch: z.object({ sehen: z.boolean().optional(), hoeren: z.enum(['', 'naeher', 'weiter']).optional(), rand: z.boolean().optional() }).optional(),
});
