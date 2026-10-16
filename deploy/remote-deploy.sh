#!/usr/bin/env bash
# Runs ON THE VM, called by ship.sh after it has copied the images, deploy
# files, migrations and Deno cache into the stack directory:
#   ./battery-lci/remote-deploy.sh
#
# Every step is a separate command under `set -euo pipefail`, so any failure
# (e.g. `docker load` hitting a full disk) stops the deploy with an error
# instead of carrying on and reporting success.
#
# Set DOCKER="sudo docker" if your VM user is not in the docker group.
set -euo pipefail

DOCKER=${DOCKER:-docker}
cd "$(dirname "$0")/.."          # the stack directory

if ! grep -qE '^COMPOSE_FILE=.*docker-compose.battery-lci.yml' .env; then
  echo "→ registering docker-compose.battery-lci.yml in COMPOSE_FILE"
  sh run.sh config add battery-lci
fi

echo "→ loading images"
gunzip -c battery-lci-images.tar.gz | $DOCKER load
rm -f battery-lci-images.tar.gz

echo "→ starting the stack"
$DOCKER compose up -d

# migrate.sh needs auth.users (created by Auth's own migrations) and the
# storage schema (created by Storage's), so wait until both report healthy.
wait_healthy() {  # wait_healthy <container> <timeout seconds>
  local c=$1 t=$2 s
  for ((i = 0; i < t; i += 2)); do
    s=$($DOCKER inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$c" 2>/dev/null || echo missing)
    [[ "$s" == healthy ]] && return 0
    sleep 2
  done
  echo "✗ $c is not healthy after ${t}s (status: $s). Check: $DOCKER compose logs ${c#supabase-}" >&2
  return 1
}
echo "→ waiting for auth and storage"
wait_healthy supabase-auth 180
wait_healthy supabase-storage 180

echo "→ migrating"
DOCKER="$DOCKER" ./battery-lci/migrate.sh

echo "→ installing the Edge Function dependency cache"
$DOCKER cp - supabase-edge-functions:/root/.cache/deno < deno-cache.tar
rm -f deno-cache.tar
$DOCKER compose restart functions

$DOCKER compose ps --format 'table {{.Name}}\t{{.Status}}'
