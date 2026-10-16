#!/usr/bin/env bash
# Tägliches Backup: Datenbank (pg_dump, custom format) und ./data (Belege, Dateien) nach /var/backups/lightback, 30 Tage.
set -euo pipefail
ZIEL=/var/backups/lightback
TAGE=30
cd "$(dirname "$0")/.."
mkdir -p "$ZIEL"
chmod 700 "$ZIEL"
T=$(date +%Y%m%d_%H%M)
docker compose exec -T db pg_dump -U lightback -d lightback -Fc > "$ZIEL/db-$T.dump.tmp"
mv "$ZIEL/db-$T.dump.tmp" "$ZIEL/db-$T.dump"
tar -czf "$ZIEL/data-$T.tar.gz" data
sha256sum "$ZIEL/db-$T.dump" "$ZIEL/data-$T.tar.gz" > "$ZIEL/sha256-$T.txt"
chmod 600 "$ZIEL"/*-"$T".*
find "$ZIEL" -type f -mtime +$TAGE -delete
echo "$(date -Is) Backup ok: db-$T.dump ($(du -h "$ZIEL/db-$T.dump" | cut -f1))"
