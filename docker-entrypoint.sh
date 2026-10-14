#!/bin/sh
set -e
# Schema anwenden (additive Änderungen), dann Server starten
prisma db push --skip-generate --schema prisma/schema.prisma
exec node server.js
