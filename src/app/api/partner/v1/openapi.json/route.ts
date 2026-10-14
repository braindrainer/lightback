import { openapi } from '@/lib/openapi';

export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json(openapi(), { headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=300', 'X-Robots-Tag': 'noindex' } });
}
