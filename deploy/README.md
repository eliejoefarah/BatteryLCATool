# Deploying to the VUB VM

Everything runs on `NEX-VMEDBAT02` (`battery-lci.vub.be`, `10.67.0.29`, VUB VPN required): self-hosted Supabase, FastAPI and the frontend. No third-party hosting. Background and the reasons behind this design are in `docs/VUB_VM_FINDINGS.md`.

The VM can **pull** Docker images but can't reach PyPI, npm or GitHub, so it can't **build** anything. Our two images are built on the laptop and copied over SSH by `ship.sh`. The stock Supabase images are pulled by the VM itself.

```
laptop ── ship.sh ──(ssh/rsync)──> /data/battery-lci/stack/          on the VM
  builds battery-lci-api          ├─ docker-compose.yml            (Supabase, unmodified)
  builds battery-lci-web          ├─ docker-compose.battery-lci.yml (ours: fastapi, web, tweaks)
                                  ├─ .env                          (secrets, only on the VM)
                                  ├─ volumes/functions/            (Supabase main/ + our functions)
                                  └─ battery-lci/                  (migrations, init.sql, migrate.sh, remote-deploy.sh)
```

Browser → F5 (TLS) → `web` (Caddy :80) → `/api/*` to `fastapi`, `/auth /rest /storage /functions` to `kong`, everything else served as the SPA.

## Files

| File | Runs where | Purpose |
|---|---|---|
| `ship.sh` | laptop | Check `.env`, build images, copy everything, then run `remote-deploy.sh` on the VM. **The deploy command.** |
| `check-env.sh` | VM (fed over SSH by `ship.sh`) | Preflight: refuses to deploy if a required `.env` value is empty, a `<placeholder>`, a Supabase demo default, or an unsafe setting (e.g. `DISABLE_SIGNUP` not `true`). |
| `remote-deploy.sh` | VM (called by `ship.sh`) | Load images, `compose up`, wait for auth and storage, migrate, install the Deno cache, restart functions. Stops at the first failed step. |
| `docker-compose.battery-lci.yml` | VM | Override registered in `.env`'s `COMPOSE_FILE` by `ship.sh`. Adds `fastapi` + `web`; sets Edge Function env vars; binds Kong to localhost; stops publishing Postgres. |
| `production.env.example` | — | Checklist of `.env` values to set on the VM. |
| `warm-deno-cache.sh` | laptop | Called by `ship.sh`. Boots every Edge Function once with internet and packages the filled Deno cache, which `ship.sh` copies into the VM's functions container (the VM can't reach npm/jsr). |
| `migrate.sh` | VM | Applies new migrations (tracked in `deploy.migration`, a schema PostgREST doesn't expose), then `init.sql`. |
| `init.sql` | VM | Storage buckets, export download policy, `on_user_created` trigger (dashboard-only setup in the cloud project). |
| `../web/Dockerfile`, `../web/Caddyfile` | laptop build | Frontend image (build SPA → serve with Caddy). |

## One-time setup

**On the VM:**
```bash
sudo mkdir -p /data/battery-lci && sudo chown eliejoe: /data/battery-lci
```

**On the laptop:** get Supabase's self-hosting files (the VM can't clone them):
```bash
git clone --depth 1 https://github.com/supabase/supabase /tmp/supabase
rsync -a /tmp/supabase/docker/ eliejoe@10.67.0.29:/data/battery-lci/stack/
# Record which Supabase version you installed: updating later needs it (see "Updating Supabase")
git -C /tmp/supabase rev-parse HEAD | ssh eliejoe@10.67.0.29 'cat > /data/battery-lci/stack/.supabase-from'
```

**On the VM:** create the `.env`:
```bash
cd /data/battery-lci/stack
cp .env.example .env && chmod 600 .env
sh utils/generate-keys.sh --update-env   # writes fresh JWT_SECRET, ANON_KEY, SERVICE_ROLE_KEY, passwords, …
nano .env                                # set every key listed in deploy/production.env.example
```
Generate `WEBHOOK_SECRET` and `INTERNAL_API_SECRET` with `openssl rand -hex 32`.

**Back up `.env` somewhere safe** (e.g. a password manager). Losing `JWT_SECRET` logs everyone out; losing `POSTGRES_PASSWORD` locks you out of the database.

## Deploying (first time and every update)

From the laptop, VPN on:
```bash
./deploy/ship.sh
```
It builds both images, copies them plus the compose override, Edge Functions and migrations, runs `docker compose up -d`, applies new migrations, and restarts the functions. Re-running is safe. Only new migrations are applied.

- `SKIP_BUILD=1 ./deploy/ship.sh`: re-ship without rebuilding.
- `REMOTE_DOCKER='sudo docker' ./deploy/ship.sh`: for a VM user who isn't in the `docker` group. (`eliejoe` is, since 2026-10-16.)

## Checking it works

```bash
ssh -L 8080:localhost:80 -L 8000:localhost:8000 eliejoe@10.67.0.29
#   http://localhost:8080   → the app, bypassing the F5
#   http://localhost:8000   → Supabase Studio (DASHBOARD_USERNAME / DASHBOARD_PASSWORD)
cd /data/battery-lci/stack
docker compose ps                               # everything Up / healthy
docker compose logs -f fastapi functions auth   # the usual suspects
curl -sI localhost | head -1                         # web (Caddy) answers
docker exec battery-lci-api python -c "import urllib.request;print(urllib.request.urlopen('http://localhost:8000/health').read())"
```

Logging in via the tunnel at `localhost:8080` won't fully work, because auth redirects and the frontend's baked-in URLs point at `https://battery-lci.vub.be`. Use the tunnel to check that pages load, and the real URL for login.

**How login works.** Users sign in with email + password, or with an emailed sign-in link. Invited users get a "Choose a password" screen when they open their invite link (they can skip it and keep using links). "Forgot password?" emails a reset link. Passwords need 12+ characters, and changing one in Profile requires the current password (settings in `docker-compose.battery-lci.yml`, `auth` service).

**First admin user.** Sign-up is disabled, and only admins can invite. Create the first user in Studio (Authentication → Add user) **with a password of 12+ characters**: password login works without SMTP, so this account can log in before the relay exists. The `on_user_created` trigger gives it an `app_user` row with role `manufacturer`. Promote it in the SQL editor:
```sql
UPDATE public.app_user SET role = 'admin' WHERE email = '<you>@vub.be';
```

**Seed the ecoinvent catalog** (once, after the first deploy). Flow mapping and export need `bw_activity_catalog`. It's filled from `scripts/ecoinvent_activity_catalog.csv` (ecoinvent 3.12 cutoff, ~26.5k activities) by the existing seed script, run from the laptop through an SSH tunnel. Postgres isn't published on the VM, so the tunnel points at the database container's internal IP:
```bash
# on the laptop, VPN on, from the repo root
DBIP=$(ssh eliejoe@10.67.0.29 "docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' supabase-db")
ssh -fN -L 5433:$DBIP:5432 eliejoe@10.67.0.29          # tunnel in the background
PW=$(ssh eliejoe@10.67.0.29 "grep -E '^POSTGRES_PASSWORD=' /data/battery-lci/stack/.env | cut -d= -f2-")
scripts/venv/bin/python scripts/seed_bw_catalog.py --file scripts/ecoinvent_activity_catalog.csv \
  --db "postgresql://postgres:$PW@localhost:5433/postgres"
pkill -f "5433:$DBIP:5432"                              # close the tunnel
```
It's safe to re-run, since duplicates are skipped. For a new ecoinvent version, export a new CSV and run it again, adding `--clear` to replace that version's rows. **The CSV is licensed ecoinvent data:** it stays out of git (`scripts/` is ignored) and out of the images. It only goes into the VM's database.

**Full test pass:** login, create a project, xlsx import, validation, export download, catalog edit, Monte Carlo, invite a user (needs SMTP), and confirm the invited user has an `app_user` row.

## Updating and maintenance

The rule of thumb: **every change is made on the laptop and delivered with `./deploy/ship.sh`.** The VM has no internet beyond image pulls, so nothing is ever installed, built or downloaded on it directly. Back up the database before anything risky (see **Backups** below).

### What to do for each kind of change

| You changed… | Do this | Notes |
|---|---|---|
| Frontend code (`web/`) | `./deploy/ship.sh` | Rebuilds the web image. |
| FastAPI code or `api/requirements.txt` | `./deploy/ship.sh` | Packages are installed on the laptop during the build, never on the VM. |
| Edge Function code, same imports | `./deploy/ship.sh` | Nothing new to download. The cache is still valid. |
| An Edge Function import (new package, or a version bump) | Change it, then `./deploy/ship.sh` | See **Edge Function dependency cache** below. The cache is re-warmed automatically. |
| A new migration in `supabase/migrations/` | `./deploy/ship.sh` | `migrate.sh` applies only files not yet in `deploy.migration`. **Never edit a migration that's already been applied.** Add a new numbered file instead. |
| `.env` on the VM (URLs, SMTP, secrets) | Edit on the VM, then `./deploy/ship.sh` | `ship.sh` recreates changed containers and rebuilds the frontend with the current `ANON_KEY`. |
| `deploy/init.sql` | `./deploy/ship.sh` | Idempotent, re-run on every deploy. |
| The Supabase stack itself | See **Updating Supabase** below | |
| A new ecoinvent version / catalog CSV | Re-run the seed command in **Checking it works** (with `--clear`) | No deploy needed. |

### Edge Function dependency cache

**Why it exists.** Edge Functions have no build step: Deno downloads each function's imports the first time it boots, then keeps them in a cache (`/root/.cache/deno`, stored in the `deno-cache` Docker volume). The VM can't reach npm or jsr, so `ship.sh` runs `warm-deno-cache.sh` on the laptop. That script boots every function once with internet, packages the filled cache (~14 MB), and `ship.sh` copies it into the VM's functions container.

**It doesn't expire.** Deno's cache has no time limit and doesn't re-check the registry for cached packages. As long as you don't change imports and the volume isn't deleted, it keeps working indefinitely.

**When it must be refreshed.** Re-running `./deploy/ship.sh` handles all of these:

| Event | Why |
|---|---|
| You add or change an import in a function | The new package isn't in the cache yet. |
| You update Supabase (new edge-runtime version) | A newer runtime may use a different cache format. `ship.sh` always warms with the version the VM runs. |
| The `deno-cache` volume was deleted (`docker compose down -v`, `reset.sh`, `docker volume rm`) | The cache is gone. (`down -v` and `reset.sh` also delete the database, so only use them deliberately.) |

Rebooting the VM, `docker compose restart`, `up` or `down` (without `-v`), and recreated containers all **keep** the cache.

**Pinned versions.** Our functions import `npm:@supabase/supabase-js@2.98.0`, an exact version, the same one the frontend uses. With a range like `@2`, each re-warm could pull whatever 2.x was published that day. To bump it:
1. Change the version in **both** `supabase/functions/_shared/utils.ts` and `supabase/functions/deno.json`.
2. Test locally (`supabase functions serve`).
3. `./deploy/ship.sh`. The warm-up output lists each function with ✓.

Supabase's own `main/` router imports `jsr:@panva/jose@6` (a range). That file belongs to Supabase and is replaced on Supabase updates, so leave it. It's cached the same way.

**Symptoms of a missing cache.** Functions return `{"code":"BOOT_ERROR",...}`, and `docker compose logs functions` shows a failed request to `jsr.io` or `registry.npmjs.org` ("dns error" / "failed to lookup address"). Fix: `./deploy/ship.sh` (or `SKIP_BUILD=1 ./deploy/ship.sh` to skip rebuilding the images).

**If warm-up fails on the laptop** (a function shows ✗), the problem is in that function's imports or code, not the VM. The script prints the edge-runtime logs. The deploy stops before anything is copied, so the VM keeps running the previous version.

### Updating Supabase

Supabase's `update.sh` merges a newer version of their files with yours, but it downloads from GitHub, so run it on a **copy on the laptop** and send the result back.

```bash
# 1. On the VM: back up first (see Backups)
# 2. On the laptop: copy the stack, without the data
rsync -a --exclude 'volumes/db/data' --exclude 'volumes/storage' --exclude '*.tar*' \
  eliejoe@10.67.0.29:/data/battery-lci/stack/ ~/battery-lci-stack/
cd ~/battery-lci-stack
sh update.sh --from "$(cat .supabase-from)" --dry-run    # read the summary and Supabase's CHANGELOG.md
sh update.sh --from "$(cat .supabase-from)"
# 3. Send it back (again without the data), then redeploy
rsync -a --exclude 'volumes/db/data' --exclude 'volumes/storage' \
  ~/battery-lci-stack/ eliejoe@10.67.0.29:/data/battery-lci/stack/
./deploy/ship.sh      # pulls new images, re-warms the Deno cache for the new runtime, restarts
# 4. Record the new version, and delete the laptop copy (its .env holds the production secrets)
git ls-remote https://github.com/supabase/supabase <tag you updated to> | cut -f1 \
  | ssh eliejoe@10.67.0.29 'cat > /data/battery-lci/stack/.supabase-from'
rm -rf ~/battery-lci-stack
```

After an update, check that `docker-compose.battery-lci.yml` still matches: the service names (`api-gw`, `functions`, `db`, `supavisor`), the `kong` network alias, and the `edge-runtime` image line `ship.sh` greps for. Then run the full test pass. **Major Postgres upgrades** (e.g. 17 → 18) need Supabase's dedicated upgrade script and a backup. Don't do one as part of a routine update.

There's no need to update often. Do it for security fixes, or when a feature needs it.

### Backups

VUB backs up the whole VM. For quick restores of just the app data, take a database dump before risky changes:
```bash
mkdir -p /data/battery-lci/backups
docker exec supabase-db pg_dumpall -h localhost -U supabase_admin | gzip > /data/battery-lci/backups/$(date +%F).sql.gz
```
Uploaded and exported files live in `/data/battery-lci/stack/volumes/storage/`. Back that folder up together with the dump.

## Known gaps

- **SMTP needs TLS if it uses a password.** GoTrue refuses to send SMTP credentials over an unencrypted connection (invites then fail with `Error sending invite email`, and the auth logs say `unencrypted connection`). VUB's relay on port 587 should offer STARTTLS. If it doesn't, ask IT for a TLS port, or for relay without credentials (`SMTP_USER`/`SMTP_PASS` empty).
- **SMTP is needed for invites, sign-in links and password resets.** Password login works without it, so the Studio-created admin can log in, but nobody else can be onboarded until VUB IT provides the relay. Stopgap for testing a link-based flow: generate a login link over the SSH tunnel with the service key (`POST http://localhost:8000/auth/v1/admin/generate_link` with `{"type":"magiclink","email":"…"}`) and open the returned `action_link`.
- **F5 → VM port 80** (confirmed by IT). `web` listens on 80 (`WEB_HTTP_PORT`). If the F5 can't connect, the VM's own firewall (`fwbuilder`) may need the port opened by IT.
- **External access** is being requested by IT. Until then the site is VPN-only.
- **Per-IP rate limits on login are not set yet, and they're required before the site is public.** With password login, `/auth/v1/token` would otherwise allow unlimited password guessing. Needs the F5 details from VUB IT (its source IPs, and whether it sends `X-Forwarded-For`) to set `GOTRUE_RATE_LIMIT_HEADER` safely.
- **AI Suggest** (flow mapping) calls the Anthropic API, a third party, and is blocked anyway. `ANTHROPIC_API_KEY` is deliberately not set, so the feature is off.
- **No automatic app-level backups yet.** A nightly cron job for the dump command in **Backups** would make restores quicker than restoring the whole VM.
