#!/usr/bin/env bash
# Preflight check of the VM's stack .env. ship.sh runs it on the VM over SSH
# (fed on stdin, so it never needs copying):
#   ssh <vm> bash -s -- /data/battery-lci/stack < deploy/check-env.sh
# Also usable directly: ./deploy/check-env.sh /path/to/stack
#
# Fails the deploy before anything is built or copied if a required value is
# missing, still a placeholder from production.env.example, still one of
# Supabase's public demo defaults, or an unsafe setting.
set -euo pipefail

STACK=${1:?usage: check-env.sh <stack dir>}
ENV_FILE="$STACK/.env"
[[ -f "$ENV_FILE" ]] || { echo "✗ $ENV_FILE not found" >&2; exit 1; }

env_get() {
  { grep -E "^$1=" "$ENV_FILE" || true; } | tail -n1 | cut -d= -f2- \
    | sed -E "s/^\"(.*)\"\$/\\1/; s/^'(.*)'\$/\\1/"
}

errors=()
fail() { errors+=("$1"); }

# Required, non-empty, not a <placeholder>, not a Supabase .env.example demo value
for key in POSTGRES_PASSWORD JWT_SECRET ANON_KEY SERVICE_ROLE_KEY DASHBOARD_PASSWORD \
           SECRET_KEY_BASE VAULT_ENC_KEY PG_META_CRYPTO_KEY \
           WEBHOOK_SECRET INTERNAL_API_SECRET \
           SITE_URL API_EXTERNAL_URL SUPABASE_PUBLIC_URL; do
  v=$(env_get "$key")
  if [[ -z "$v" ]]; then fail "$key is empty or missing"; continue; fi
  [[ "$v" == *"<"*">"* ]] && fail "$key is still a <placeholder>"
  case "$v" in
    *your-super-secret*|*this_password_is_insecure*|*your-encryption-key*|*your-32-character*|\
    UpNVntn3cDxHJpq99YMc1T1AQgQpc8kfYTuRgBiYa15BLrx8etQoXz3gZv1/u2oq|\
    eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyAgCiAgICAicm9sZSI6ICJhbm9uIi*|\
    eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyAgCiAgICAicm9sZSI6ICJzZXJ2aWNlX3JvbGUi*)
      fail "$key is still Supabase's public demo value (run utils/generate-keys.sh --update-env)" ;;
  esac
done

# App secrets: long and URL/SQL-safe (migrate.sh embeds WEBHOOK_SECRET in SQL)
for key in WEBHOOK_SECRET INTERNAL_API_SECRET; do
  v=$(env_get "$key")
  [[ -z "$v" || "$v" =~ ^[A-Za-z0-9_-]{32,}$ ]] || fail "$key must be 32+ chars of [A-Za-z0-9_-] (openssl rand -hex 32)"
done
pw=$(env_get POSTGRES_PASSWORD)
[[ -z "$pw" || "$pw" =~ ^[A-Za-z0-9_-]+$ ]] || fail "POSTGRES_PASSWORD must be [A-Za-z0-9_-] only (it's embedded in a URL)"

# Settings that are unsafe or broken when wrong
[[ "$(env_get DISABLE_SIGNUP)" == "true" ]] \
  || fail "DISABLE_SIGNUP must be true (open sign-up lets anyone create an account)"
[[ "$(env_get FUNCTIONS_VERIFY_JWT)" == "false" ]] \
  || fail "FUNCTIONS_VERIFY_JWT must be false (on_user_created is called with the webhook secret, not a JWT)"
api_ext=$(env_get API_EXTERNAL_URL)
[[ -z "$api_ext" || "$api_ext" == */auth/v1 ]] || fail "API_EXTERNAL_URL must end in /auth/v1"
for key in SITE_URL API_EXTERNAL_URL SUPABASE_PUBLIC_URL; do
  v=$(env_get "$key")
  [[ -z "$v" || "$v" == https://* ]] || fail "$key should be https:// (public URL behind the F5), got: $v"
done

if (( ${#errors[@]} )); then
  echo "✗ $ENV_FILE has problems:" >&2
  printf '  - %s\n' "${errors[@]}" >&2
  exit 1
fi
echo "  ✓ .env looks good"
