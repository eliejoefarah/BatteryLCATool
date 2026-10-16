#!/usr/bin/env bash
# Runs ON THE LAPTOP (VUB VPN on), from anywhere:  ./deploy/ship.sh
#
# Builds the api + web images locally, copies them and the deploy files to the
# VM over SSH, then runs remote-deploy.sh there (load images, restart, migrate,
# install the Edge Function cache). The VM can pull images but can't reach
# PyPI/npm, so it never builds anything.
#
# Prerequisite: the one-time VM setup in deploy/README.md (stack dir + .env).
#
# Overrides (env vars):
#   VM=eliejoe@10.67.0.29   STACK=/data/battery-lci/stack
#   PUBLIC_URL=https://battery-lci.vub.be
#   REMOTE_DOCKER="sudo docker"   (if your VM user is not in the docker group)
#   SKIP_BUILD=1                   (re-ship the last built images)
set -euo pipefail

VM=${VM:-eliejoe@10.67.0.29}
STACK=${STACK:-/data/battery-lci/stack}
PUBLIC_URL=${PUBLIC_URL:-https://battery-lci.vub.be}
REMOTE_DOCKER=${REMOTE_DOCKER:-docker}
REPO="$(cd "$(dirname "$0")/.." && pwd)"
TARBALL=battery-lci-images.tar.gz

# Our functions, as they're copied anywhere: never the local dev .env files
# (git-ignored, but present in the working tree).
FUNCTION_EXCLUDES=(--exclude '.env' --exclude '.env.*')

echo "== Preflight"
ssh -o ConnectTimeout=10 "$VM" "test -f $STACK/docker-compose.yml && test -f $STACK/.env" \
  || { echo "Can't reach $VM or $STACK isn't set up (VPN on? one-time setup done?)" >&2; exit 1; }
ssh "$VM" bash -s -- "$STACK" < "$REPO/deploy/check-env.sh"

# The anon key is public (it ships in the frontend bundle). Read it from the
# VM's .env so the build always matches the running stack.
ANON_KEY=$(ssh "$VM" "grep -E '^ANON_KEY=' $STACK/.env | tail -n1 | cut -d= -f2-" | sed -E "s/^\"(.*)\"\$/\\1/; s/^'(.*)'\$/\\1/")
[[ -n "$ANON_KEY" ]] || { echo "ANON_KEY not found in $STACK/.env" >&2; exit 1; }

if [[ -z "${SKIP_BUILD:-}" ]]; then
  echo "== Building images"
  docker build --platform linux/amd64 -t battery-lci-api:latest "$REPO/api"
  docker build --platform linux/amd64 -t battery-lci-web:latest \
    --build-arg VITE_SUPABASE_URL="$PUBLIC_URL" \
    --build-arg VITE_SUPABASE_ANON_KEY="$ANON_KEY" \
    --build-arg VITE_RAILWAY_FASTAPI_URL="$PUBLIC_URL" \
    "$REPO/web"
fi

echo "== Copying images to the VM"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
docker save battery-lci-api:latest battery-lci-web:latest | gzip > "$TMP/$TARBALL"
rsync -h --progress "$TMP/$TARBALL" "$VM:$STACK/$TARBALL"

echo "== Pre-fetching Edge Function dependencies (the VM can't reach npm/jsr)"
# Warm with exactly what the VM will run: its edge-runtime version, Supabase's
# main/ router and import map from the VM, and our functions on top.
EDGE_IMAGE=$(ssh "$VM" "grep -m1 -oE 'supabase/edge-runtime:[^\" ]+' $STACK/docker-compose.yml")
mkdir -p "$TMP/functions"
rsync -a "$VM:$STACK/volumes/functions/main" "$VM:$STACK/volumes/functions/deno.jsonc" "$TMP/functions/"
rsync -a "${FUNCTION_EXCLUDES[@]}" "$REPO/supabase/functions/" "$TMP/functions/"
"$REPO/deploy/warm-deno-cache.sh" "$TMP/functions" "$EDGE_IMAGE" "$TMP/deno-cache.tar"
rsync -a "$TMP/deno-cache.tar" "$VM:$STACK/deno-cache.tar"

echo "== Copying deploy files"
rsync -a "$REPO/deploy/docker-compose.battery-lci.yml" "$VM:$STACK/docker-compose.battery-lci.yml"
# --delete removes functions that were deleted from the repo (and Supabase's
# sample hello/), so they stop being callable. Supabase's main/ router and
# deno.jsonc are protected (P) from deletion.
rsync -a --delete "${FUNCTION_EXCLUDES[@]}" --filter 'P /main/' --filter 'P /deno.jsonc' \
  "$REPO/supabase/functions/" "$VM:$STACK/volumes/functions/"
ssh "$VM" "mkdir -p $STACK/battery-lci"
rsync -a --delete "$REPO/supabase/migrations/" "$VM:$STACK/battery-lci/migrations/"
rsync -a "$REPO/deploy/init.sql" "$REPO/deploy/migrate.sh" "$REPO/deploy/remote-deploy.sh" "$VM:$STACK/battery-lci/"

echo "== Loading images, restarting, migrating"
ssh -t "$VM" "DOCKER='$REMOTE_DOCKER' $STACK/battery-lci/remote-deploy.sh"

echo "== Deployed. Check $PUBLIC_URL (or: ssh -L 8080:localhost:80 $VM → http://localhost:8080)"
