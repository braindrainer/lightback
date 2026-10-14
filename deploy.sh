#!/bin/sh
# Neu bauen und starten (Datenbank bleibt)
set -e
cd "$(dirname "$0")"
docker compose build app
docker compose up -d app
docker compose ps app
