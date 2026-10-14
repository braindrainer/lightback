// Host-Weiche: auf lightapp.* nur die Vor-Ort-App (Einlass, Kassa, Anmeldung), alles andere führt zum Scanner.
import { NextResponse, type NextRequest } from 'next/server';
import { istAppHost } from '@/lib/apphost';

const ERLAUBT = [/^\/einlass(\/|$)/, /^\/kassa(\/|$)/, /^\/login$/, /^\/api\/(auth|einlass|kassa)(\/|$)/, /^\/_next\//, /^\/icons\//, /^\/img\//, /^\/sw-(einlass|kassa)\.js$/, /^\/manifest-[a-z]+\.webmanifest$/, /^\/favicon\.ico$/];

// Middleware verlangt absolute Ziele: Adresse aus Host (nginx: proxy_set_header Host $host) und X-Forwarded-Proto,
// nicht aus req.url – hinter nginx kennt der Container seine öffentliche Adresse nicht.
function weiter(req: NextRequest, pfad: string) {
  const proto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || req.nextUrl.protocol.replace(':', '');
  const host = req.headers.get('host') ?? req.nextUrl.host;
  return NextResponse.redirect(new URL(pfad, `${proto}://${host}`), { status: 307, headers: { 'Cache-Control': 'no-store' } });
}

export function middleware(req: NextRequest) {
  if (!istAppHost(req.headers)) return NextResponse.next();
  const { pathname, searchParams } = req.nextUrl;
  // Fehlende Rolle (requireRole leitet nach /?verboten=1): zur Anmeldung mit Hinweis statt Schleife
  if (pathname === '/' && searchParams.has('verboten')) return weiter(req, '/login?fehler=rolle');
  // Manifest der Startseite und des Scanners: das der App-Domain (Start /einlass, Scope /)
  if (pathname === '/manifest.webmanifest' || pathname === '/manifest-einlass.webmanifest') {
    const u = req.nextUrl.clone();
    u.pathname = '/manifest-lightapp.webmanifest';
    return NextResponse.rewrite(u);
  }
  if (ERLAUBT.some((r) => r.test(pathname))) return NextResponse.next();
  return weiter(req, '/einlass');
}

export const config = { matcher: ['/((?!_next/static|_next/image).*)'] };
