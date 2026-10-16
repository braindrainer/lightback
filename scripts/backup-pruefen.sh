#!/usr/bin/env bash
# Wiederherstellungstest: jüngstes Backup in eine Wegwerf-Datenbank einspielen und Zeilen zählen.
set -euo pipefail
cd "$(dirname "$0")/.."
D=$(ls -1t /var/backups/lightback/db-*.dump | head -1)
docker compose exec -T db dropdb -U lightback --if-exists lb_restore_test
docker compose exec -T db createdb -U lightback lb_restore_test
docker compose exec -T db pg_restore -U lightback -d lb_restore_test --no-owner < "$D"
N=$(docker compose exec -T db psql -U lightback -d lb_restore_test -tAc 'SELECT count(*) FROM "AuditLog"')
docker compose exec -T db dropdb -U lightback lb_restore_test
echo "$(date -Is) Restore-Test ok: $D, $N Protokolleinträge"
