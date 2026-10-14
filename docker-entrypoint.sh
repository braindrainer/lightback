#!/bin/sh
set -e
# Protokollspalten vorbereiten, Schema anwenden (additive Änderungen), Schutz-Trigger setzen, dann Server starten
tsx scripts/schutz.ts --spalten
prisma db push --skip-generate --schema prisma/schema.prisma
tsx scripts/schutz.ts
exec node server.js
