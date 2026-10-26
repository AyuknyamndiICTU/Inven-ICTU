# Runbook — Deploy, upgrade and roll back the LabPass server

Everything runs from `deploy/compose.prod.yml` on one Linux server (4 vCPU, 8 GB RAM, 100 GB SSD is ample for 50 000 students). Containers:

- `postgres`, `redis`
- `migrate` (one-shot)
- `tools` (on demand, profile `tools`: seed and stock reconcile)
- `api`, `worker`
- `admin` (Next.js)
- `web` (Caddy: TLS, the student PWA, `/api`, `/downloads`)
- `backup`
- optionally `uptime-kuma`

## 1. Prerequisites (ICTU IT)

- Ubuntu 24.04 LTS (or any distribution with Docker Engine 27+ and the compose plugin), time synced (`timedatectl`).
- Two DNS names pointing at the server, e.g. `labpass.ictuniversity.edu.cm` (students, kiosks) and `admin.labpass.ictuniversity.edu.cm` (staff).
- Ports 80 and 443 open from the campus network. For the TLS certificate, choose one (it must be publicly trusted: phones refuse passkeys and app install with an internal CA):
  - **Public server:** Caddy gets a Let's Encrypt certificate automatically (port 80/443 reachable from the internet).
  - **Campus-only server:** use ICTU's wildcard certificate (see the note at the top of `deploy/caddy/Caddyfile`), or Let's Encrypt DNS-01 with a Caddy build that includes ICTU's DNS provider module (`xcaddy build --with github.com/caddy-dns/<provider>`).
- SSH access only for named IT staff; no other inbound ports.

## 2. First install

```sh
git clone https://github.com/AyuknyamndiICTU/Inven-ICTU.git /opt/labpass && cd /opt/labpass
git checkout labpass/v1.0.0                       # always deploy a tag
cp deploy/env.prod.example deploy/.env.prod && chmod 600 deploy/.env.prod
$EDITOR deploy/.env.prod                          # replace every <...>; see the secret commands at the top
install -m 600 /dev/null deploy/secrets/desfire_master_keys   # filled later, see desfire-keys.md
mkdir -p deploy/backups deploy/downloads
docker compose -f deploy/compose.prod.yml --env-file deploy/.env.prod build
docker compose -f deploy/compose.prod.yml --env-file deploy/.env.prod up -d
docker compose -f deploy/compose.prod.yml --env-file deploy/.env.prod ps   # all healthy / migrate exited 0
```

Then:

1. **First administrator.** Run the seed once. In production it creates only the equipment categories and the SUPER_ADMIN; demo items and synthetic students need `LABPASS_SEED_DEMO=1`, which you should never use on the real server. It never touches existing data.

   ```sh
   docker compose -f deploy/compose.prod.yml --env-file deploy/.env.prod --profile tools run --rm \
     -e LABPASS_SEED_ADMIN_EMAIL=<owner@ictuniversity.edu.cm> tools pnpm --filter @labpass/api db:seed
   ```

   The generated password is printed once. Sign in at `https://admin.<domain>`, change the password and enrol TOTP when prompted.

2. **Check the API:**
   - `curl -fsS https://<domain>/api/ready` returns `{"status":"ready","db":true,"redis":true}`.
   - `curl -fsS https://<domain>/api/health/kiosks` returns 200 (no kiosks yet).
3. **Import students:** Admin → Students → Import (CSV/XLSX), or configure the SIS connector.
4. **Register kiosks:** follow [kiosk.md §2](./kiosk.md). The kiosk API URL is `https://<domain>/api`.
5. **Publish the Android APK** into `deploy/downloads/` ([android-release.md](./android-release.md)).
6. **Set up monitoring** ([monitoring.md](./monitoring.md)) and **verify the first backup** the next morning ([backup-restore.md](./backup-restore.md)).

## 3. Upgrade

1. Read the release notes for migrations that need downtime. Most migrations are additive and run in seconds.
2. Take an on-demand backup:

   ```sh
   docker compose -f deploy/compose.prod.yml --env-file deploy/.env.prod exec backup labpass-backup
   ```

3. Check out the new tag, then rebuild and restart:

   ```sh
   git fetch --tags && git checkout labpass/vX.Y.Z
   sed -i 's/^LABPASS_VERSION=.*/LABPASS_VERSION=X.Y.Z/' deploy/.env.prod
   docker compose -f deploy/compose.prod.yml --env-file deploy/.env.prod up -d --build
   ```

   `migrate` runs before the new `api` starts; if it fails, the old containers keep running.

4. Smoke test:
   - `/api/ready` responds;
   - sign in to the admin console;
   - do one tap at a kiosk, then borrow and return a test item.

Kiosks keep working offline for the minute or so the API restarts ([kiosk-offline.md](./kiosk-offline.md)).

## 4. Roll back

- **No database migration in the release:** set `LABPASS_VERSION` back and check out the previous tag, then run `up -d --build`.
- **The release included a migration:** Prisma migrations are forward-only.
  - If the new migration only _added_ tables or columns, the previous version still works against the newer schema. Roll back as above.
  - Otherwise, restore the pre-upgrade backup ([backup-restore.md §3](./backup-restore.md)), then start the previous tag.
- Record the rollback and its reason in the release notes.

## 5. Useful commands

```sh
alias lp='docker compose -f /opt/labpass/deploy/compose.prod.yml --env-file /opt/labpass/deploy/.env.prod'
lp logs -f --tail=200 api worker          # JSON logs (pino); no personal data
lp exec postgres psql -U labpass labpass  # read-only investigation; never edit stock rows by hand
lp --profile tools run --rm tools pnpm --filter @labpass/api ops:reconcile   # stock ledger ↔ balances check (exit 0 = OK)
lp restart worker                         # notifications stuck in the outbox
```
