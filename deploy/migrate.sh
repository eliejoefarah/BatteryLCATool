#!/usr/bin/env bash
# Runs ON THE VM, from the stack directory (/data/battery-lci/stack):
#   ./battery-lci/migrate.sh
#
# 1. Applies supabase/migrations/*.sql in order, each in its own transaction,
#    recording applied files in deploy.migration so re-runs only apply new ones
#    (safe to run on every deploy).
# 2. Runs init.sql (buckets, storage policy, on_user_created trigger).
#
# Set DOCKER="sudo docker" if your VM user is not in the docker group.
set -euo pipefail

DOCKER=${DOCKER:-docker}
DB_CONTAINER=${DB_CONTAINER:-supabase-db}
HERE="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="${ENV_FILE:-$HERE/../.env}"

# Read single keys instead of sourcing: Supabase's .env has unquoted values
# with spaces that a shell can't source. Strips one pair of surrounding quotes.
env_get() {
  { grep -E "^$1=" "$ENV_FILE" || true; } | tail -n1 | cut -d= -f2- \
    | sed -E "s/^\"(.*)\"\$/\\1/; s/^'(.*)'\$/\\1/"
}

POSTGRES_PASSWORD=$(env_get POSTGRES_PASSWORD)
WEBHOOK_SECRET=$(env_get WEBHOOK_SECRET)
[[ -n "$POSTGRES_PASSWORD" ]] || { echo "POSTGRES_PASSWORD missing in $ENV_FILE" >&2; exit 1; }
[[ "$WEBHOOK_SECRET" =~ ^[A-Za-z0-9_-]{32,}$ ]] \
  || { echo "WEBHOOK_SECRET in $ENV_FILE must be 32+ chars of [A-Za-z0-9_-] (openssl rand -hex 32)" >&2; exit 1; }

# PGPASSWORD is exported and passed by name (-e PGPASSWORD), so its value
# doesn't appear in the process list.
export PGPASSWORD="$POSTGRES_PASSWORD"
psql_as() {  # psql_as <role> [psql args...]   (SQL on stdin)
  local role=$1; shift
  $DOCKER exec -i -e PGPASSWORD "$DB_CONTAINER" \
    psql -h localhost -U "$role" -d postgres -v ON_ERROR_STOP=1 -q "$@"
}

# Tracking table lives in its own schema: `public` is exposed through
# PostgREST, so a table there would be readable/writable with the anon key.
psql_as postgres <<'SQL'
SET client_min_messages = warning;
CREATE SCHEMA IF NOT EXISTS deploy;
REVOKE ALL ON SCHEMA deploy FROM PUBLIC, anon, authenticated;
CREATE TABLE IF NOT EXISTS deploy.migration (
  filename   text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
-- Carry over rows from the earlier public._deploy_migration, then drop it
DO $$
BEGIN
  IF to_regclass('public._deploy_migration') IS NOT NULL THEN
    INSERT INTO deploy.migration (filename, applied_at)
      SELECT filename, applied_at FROM public._deploy_migration
      ON CONFLICT (filename) DO NOTHING;
    DROP TABLE public._deploy_migration;
  END IF;
END
$$;
SQL

applied=$(psql_as postgres -At -c 'SELECT filename FROM deploy.migration' </dev/null)

count=0
for f in "$HERE"/migrations/*.sql; do
  name=$(basename "$f")
  grep -qxF "$name" <<<"$applied" && continue
  echo "→ applying $name"
  { cat "$f"; echo; echo "INSERT INTO deploy.migration (filename) VALUES ('$name');"; } \
    | psql_as postgres --single-transaction
  count=$((count + 1))
done
echo "Migrations: $count applied, $(grep -c . <<<"$applied" || true) already present."

# The secret goes in on stdin (validated above as [A-Za-z0-9_-]), not as a
# command-line argument.
echo "→ running init.sql"
{ printf "\\set webhook_secret '%s'\n" "$WEBHOOK_SECRET"; cat "$HERE/init.sql"; } \
  | psql_as supabase_admin
echo "Done."
