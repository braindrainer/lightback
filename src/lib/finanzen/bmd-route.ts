// Schnittstelle für den BMD-Konnektor: Bearer-Schlüssel, Fehlerformat wie die übrigen APIs
import { begrenzen, clientIp, fehlerAntwort } from '../schnittstelle';
import { konnektorPruefen } from './bmd-uebergabe';

type Ctx<P> = { params: Promise<P> };
export function bmdRoute<P = Record<string, never>>(handler: (req: Request, params: P) => Promise<Response>) {
  return async (req: Request, ctx: Ctx<P>) => {
    try {
      begrenzen(`bmd:${clientIp(req)}`, 60);
      await konnektorPruefen(req);
      return await handler(req, await ctx.params);
    } catch (e) {
      return fehlerAntwort(e);
    }
  };
}

export const nummerAus = (s: string) => {
  const n = Number(s);
  return Number.isInteger(n) && n > 0 ? n : -1;
};
