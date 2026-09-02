# On-Premises Deployment

Run TeleBid Enterprise on your own server instead of AWS — a single
Docker Compose stack: Postgres, the backend, and Caddy as a reverse
proxy/TLS terminator in front of the built frontend and the API. See
`../README.md` (the AWS path) if you're hosting on AWS instead; the two
are independent, pick one.

## Validation status — read this first

Docker's daemon isn't available in the sandbox this was authored in (no
privileged access), so nothing here could be build-tested end-to-end.
What **was** checked: every environment variable referenced in
`docker-compose.prod.yml` and the Caddyfile cross-referenced by hand
against `.env.prod.example` and `backend/app/core/config.py`'s actual
`Settings` fields (no mismatches), `docker compose config` validation
(see below), and the backup/restore scripts syntax-checked and dry-run
against this session's local Postgres. **Not** verified: an actual Let's
Encrypt certificate issuance (needs a real public domain), and a real
`docker compose up --build` end-to-end. Run both as your first real
step — if `docker compose config` and a first `up --build` succeed, the
rest of this guide should hold.

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml config
```

## Prerequisites

- A Linux server (2 vCPU / 4GB RAM is comfortable for a small team; see
  "Sizing" below) with Docker and the Docker Compose plugin installed.
- Ports 80 and 443 reachable from wherever your users are (the whole
  internet, for a public domain; just your LAN, for an internal install).
- For automatic HTTPS: a domain name whose DNS A record already points at
  this server's public IP. No domain? See "LAN-only / no domain" below.

## First install

```bash
git clone <your-repo-url> telebid && cd telebid

cp .env.prod.example .env.prod
# Edit .env.prod:
#  - SITE_ADDRESS: your domain (or see "LAN-only" below)
#  - POSTGRES_PASSWORD and JWT_SECRET_KEY: generate with
#      openssl rand -hex 32
#  - SMTP_*/ANTHROPIC_API_KEY: optional, can add later (see .env.prod.example)

docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build
```

This builds the images, starts Postgres (bootstrapping the full schema
from `database/schema.sql` automatically since the data volume starts
empty), waits for it to be healthy, starts the backend, waits for *that*
to be healthy, then starts Caddy — which serves the frontend and obtains
a TLS certificate for `SITE_ADDRESS` automatically.

### LAN-only / no domain

No public domain reachable from the internet? Caddy's automatic Let's
Encrypt needs one — for an internal-only install, add a `tls internal`
line to `infra/on-premises/Caddyfile` before building, so the block
reads:

```
{$SITE_ADDRESS} {
	tls internal
	root * /srv
	...
```

Set `SITE_ADDRESS` in `.env.prod` to `:443` (or your server's LAN
IP/hostname) instead of a domain. Caddy issues its own locally-trusted
certificate — browsers will show a one-time trust warning until you
import Caddy's root CA (see Troubleshooting below).

## Verifying

```bash
curl -k https://<SITE_ADDRESS>/health
# {"status":"ok",...}
```

Then open `https://<SITE_ADDRESS>` in a browser — you should see the
TeleBid login/signup page. Signing up should work end-to-end (creates a
company + admin, logs you straight in).

## Routine operations

**Logs**
```bash
docker compose -f docker-compose.prod.yml logs -f backend   # or postgres, frontend
```

**Restart a service**
```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml restart backend
```

**Backup** (see `scripts/backup.sh` — defaults to `../../backups/` at the
repo root, 14-day retention):
```bash
./infra/on-premises/scripts/backup.sh
```
Add to root's crontab for a nightly 2am backup:
```
0 2 * * * cd /path/to/telebid && ./infra/on-premises/scripts/backup.sh >> /var/log/telebid-backup.log 2>&1
```

**Restore** (DESTRUCTIVE — overwrites the live database):
```bash
./infra/on-premises/scripts/restore.sh backups/telebid_20260115_020000.sql.gz
```

**Applying a schema update after pulling new code** (safe to run anytime —
every statement in `database/schema.sql` is idempotent, so this is a
no-op if nothing changed):
```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml exec backend python scripts/apply_schema.py
```

**Deploying new code**
```bash
git pull
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build
docker compose --env-file .env.prod -f docker-compose.prod.yml exec backend python scripts/apply_schema.py
```

**Rotating a secret** (`POSTGRES_PASSWORD` or `JWT_SECRET_KEY` in
`.env.prod`): rotating `JWT_SECRET_KEY` invalidates every active login
session (everyone has to sign in again) but needs no other coordination.
Rotating `POSTGRES_PASSWORD` needs Postgres itself updated first, then
the backend restarted — recreate the postgres container so it picks up
the new value from `.env.prod` (`docker compose --env-file .env.prod -f
docker-compose.prod.yml up -d postgres`), reset the password inside it
(`docker exec -it telebid-postgres psql -U telebid -c "ALTER USER telebid
WITH PASSWORD '<new password>';"`), then restart the backend.

## Troubleshooting

**Backend health check red / `docker compose ps` shows it unhealthy**
`docker compose -f docker-compose.prod.yml logs backend` — almost always
either Postgres wasn't ready yet (check its own health status first) or
a bad `DATABASE_URL`/`POSTGRES_PASSWORD` mismatch between what Postgres
was created with and what's currently in `.env.prod` (changing the
password in `.env.prod` after the volume already exists doesn't change
Postgres's actual password — see "Rotating a secret" above).

**Caddy won't get a certificate (public-domain mode)**
Confirm the domain's DNS A record actually points at this server's
public IP (`dig +short <SITE_ADDRESS>`), and that ports 80 and 443 are
actually reachable from the internet (not blocked by a firewall/security
group) — Let's Encrypt's HTTP challenge needs port 80 open even though
the site itself serves on 443. Check `docker compose -f
docker-compose.prod.yml logs frontend` for the specific ACME error.

**Browser shows a certificate warning (LAN-only mode)**
Expected — `tls internal` issues a certificate from Caddy's own local
root CA, which browsers don't trust by default. Export and import it
once per client machine:
```bash
docker cp telebid-frontend:/data/caddy/pki/authorities/local/root.crt ./telebid-local-ca.crt
```
Then add `telebid-local-ca.crt` to your OS/browser's trusted root
certificates. Every subsequent visit is a clean, warning-free HTTPS
connection.

## Sizing

Starting point: 2 vCPU / 4GB RAM handles a small team comfortably. The
`deploy.resources.limits` in `docker-compose.prod.yml` cap each service
conservatively (Postgres 1 CPU/1GB, backend 1 CPU/512MB, Caddy 0.5
CPU/256MB) — raise them there if you're seeing containers throttled
(`docker stats` shows a service pinned at its limit) as usage grows.
Storage: Postgres and uploaded files both live in named Docker volumes
(`postgres_data`, `upload_data`) — size the disk for your expected
document-upload volume, and make sure `scripts/backup.sh`'s output
directory (or wherever you point `BACKUP_DIR`) is on storage you already
back up externally.
