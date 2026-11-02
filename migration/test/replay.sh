#!/usr/bin/env bash
# Riapplica tutte le migrazioni su un database di prova (con supabase-stub.sql già caricato).
# Uso: migration/test/replay.sh "psql -h HOST -p PORT -U postgres -d DB"
set -euo pipefail
PSQL="$1 -v ON_ERROR_STOP=1 -q -X"
cd "$(dirname "$0")/../.."
n=0
for f in supabase/migrations/*.sql drizzle/migrations/0*.sql; do
  # pg_cron e pg_net sono simulati nello stub: si saltano solo le righe che li installano
  sed -E 's/^\s*CREATE EXTENSION IF NOT EXISTS (pg_cron|pg_net)[^;]*;/-- (estensione simulata nello stub)/I' "$f" \
    | sed -E 's/--> statement-breakpoint//' \
    | $PSQL -f - > /dev/null 2> /tmp/replay-err.txt || { echo "ERRORE in $f"; cat /tmp/replay-err.txt; exit 1; }
  n=$((n+1))
done
echo "OK: $n migrazioni applicate"
