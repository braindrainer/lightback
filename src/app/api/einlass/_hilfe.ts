// Gemeinsame Hilfen der Einlass-API: Anmeldung prüfen, JSON-Antworten
import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { assertRole, type Nutzer } from '@/lib/auth';

export async function mitRolle(f: (u: Nutzer) => Promise<Response>): Promise<Response> {
  let u: Nutzer;
  try { u = await assertRole('einlass'); } catch { return NextResponse.json({ fehler: 'Keine Berechtigung – bitte neu anmelden.' }, { status: 401 }); }
  try { return await f(u); } catch (e) { return NextResponse.json({ fehler: e instanceof ZodError ? `Ungültige Eingabe: ${e.issues[0]?.message ?? ''}` : (e as Error).message }, { status: 400 }); }
}
