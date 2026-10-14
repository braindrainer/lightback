// Relative Weiterleitung (hinter nginx kennt der Container seine öffentliche Adresse nicht)
export function weiter(pfad: string, status = 303) {
  return new Response(null, { status, headers: { Location: pfad } });
}
