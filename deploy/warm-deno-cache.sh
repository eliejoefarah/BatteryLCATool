#!/usr/bin/env bash
# Runs ON THE LAPTOP (called by ship.sh):
#   ./deploy/warm-deno-cache.sh <functions_dir> <edge_runtime_image> <out.tar>
#
# The Edge Runtime has no build step: it downloads each function's imports
# (npm:@supabase/supabase-js, and jsr:@panva/jose for Supabase's main/ router)
# the first time a function boots, then caches them in /root/.cache/deno. The
# VM can't reach npm/jsr, so we boot every function once here, with internet,
# and package the filled cache as a tar that ship.sh copies into the VM's
# functions container. Offline, the runtime then serves imports from the cache.
#
# <functions_dir> must be the full functions folder as deployed: Supabase's
# main/ (+ deno.jsonc) with our functions copied on top.
set -euo pipefail

FUNCS=$(cd "$1" && pwd); IMAGE=$2; OUT=$3
ID=blci-warm-$$
cleanup() { docker rm -f "$ID" >/dev/null 2>&1 || true; docker network rm "$ID" >/dev/null 2>&1 || true
            docker volume rm "$ID" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker network create "$ID" >/dev/null
docker volume create "$ID" >/dev/null
docker run -d --name "$ID" --network "$ID" --network-alias edge \
  -v "$FUNCS":/home/deno/functions:ro -v "$ID":/root/.cache/deno \
  -e VERIFY_JWT=false -e SUPABASE_URL=http://unused:8000 \
  -e SUPABASE_ANON_KEY=x -e SUPABASE_SERVICE_ROLE_KEY=x -e JWT_SECRET=x \
  "$IMAGE" start --main-service /home/deno/functions/main >/dev/null

probe() {  # prints the HTTP response body of POST /<function>
  docker run --rm --network "$ID" curlimages/curl -s -m 120 -X POST "http://edge:9000/$1" \
    -H 'Content-Type: application/json' -H 'Authorization: Bearer x' -d '{}' || true
}

for _ in $(seq 30); do [[ -n "$(probe _ping)" ]] && break; sleep 1; done

failed=0
for dir in "$FUNCS"/*/; do
  name=$(basename "$dir")
  [[ "$name" == main || "$name" == _* || ! -f "$dir/index.ts" ]] && continue
  body=$(probe "$name")
  # Any app-level reply (401, 400, …) means the module graph loaded and its
  # imports are now cached. BOOT_ERROR means an import couldn't be fetched.
  if [[ "$body" == *BOOT_ERROR* || -z "$body" ]]; then
    # hello/ is Supabase's sample function, not ours: don't fail the deploy on it
    [[ "$name" == hello ]] && continue
    echo "  ✗ $name failed to boot: ${body:-no response}" >&2; failed=1
  else
    echo "  ✓ $name"
  fi
done
if [[ $failed != 0 ]]; then docker logs "$ID" 2>&1 | tail -20 >&2; exit 1; fi

docker run --rm -v "$ID":/c alpine tar -C /c -cf - . > "$OUT"
echo "  cache: $(du -h "$OUT" | cut -f1)"
