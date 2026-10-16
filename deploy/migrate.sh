#!/usr/bin/env bash
# Runs ON THE VM, from the stack directory (/data/battery-lci/stack):
#   ./battery-lci/migrate.sh
#
# 1. Applies supabase/migrations/*.sql in order, each in its own transaction,
#    recording applied files in public._deploy_migration so re-runs only apply
#    new ones (safe to run on every deploy).
# 2. Runs init.sql (buckets, storage policy, on_user_created trigger).
#
# Set DOCKER="sudo docker" if your VM user is not in the docker group.
set -euo pipefail

DOCKER=${DOCKER:-docker}
DB_CONTAINER=${DB_CONTAINER:-supabase-db}
HERE="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="${ENV_FILE:-$HERE/../.env}"

# Read single keys instead of sourcing: Supabase's .env has unquoted values
# with spaces that a shell can't source.
env_get() { grep -E "^$1=" "$ENV_FILE" | tail -n1 | cut -d= -f2-; }

POSTGRES_PASSWORD=$(env_get POSTGRES_PASSWORD)
WEBHOOK_SECRET=$(env_get WEBHOOK_SECRET)
[[ -n "$POSTGRES_PASSWORD" ]] || { echo "POSTGRES_PASSWORD missing in $ENV_FILE" >&2; exit 1; }
[[ -n "$WEBHOOK_SECRET" ]]    || { echo "WEBHOOK_SECRET missing in $ENV_FILE" >&2; exit 1; }

psql_as() {  # psql_as <role> [psql args...]   (SQL on stdin)
  local role=$1; shift
  $DOCKER exec -i -e PGPASSWORD="$POSTGRES_PASSWORD" "$DB_CONTAINER" \
    psql -h localhost -U "$role" -d postgres -v ON_ERROR_STOP=1 -q "$@"
}

psql_as postgres <<'SQL'
SET client_min_messages = warning;
CREATE TABLE IF NOT EXISTS public._deploy_migration (
  filename   text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
SQL

applied=$(psql_as postgres -At -c 'SELECT filename FROM public._deploy_migration' </dev/null)

count=0
for f in "$HERE"/migrations/*.sql; do
  name=$(basename "$f")
  grep -qxF "$name" <<<"$applied" && continue
  echo "→ applying $name"
  { cat "$f"; echo; echo "INSERT INTO public._deploy_migration (filename) VALUES ('$name');"; } \
    | psql_as postgres --single-transaction
  count=$((count + 1))
done
echo "Migrations: $count applied, $(grep -c . <<<"$applied" || true) already present."

echo "→ running init.sql"
psql_as supabase_admin -v webhook_secret="$WEBHOOK_SECRET" < "$HERE/init.sql"
echo "Done."
