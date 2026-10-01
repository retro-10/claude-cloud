# OrlaDent Camp CRM

Self-hosted, lead-and-sales CRM for OrlaDent Camp course sales (Egypt, EGP, Cairo time). Never lose a lead,
always know who to contact today, and see where the funnel leaks. Next.js 15 + PostgreSQL 16, one
`docker compose up`.

* How to use it day to day: [`USER_GUIDE.md`](USER_GUIDE.md)
* Why it is built the way it is (and what was and was not verified): [`DECISIONS.md`](DECISIONS.md)
* Open questions for the owner: [`QUESTIONS.md`](QUESTIONS.md)
* What every number means: [`METRICS.md`](METRICS.md)

## Run it locally (about 5 minutes)

Requirements: Docker with Compose v2.

```bash
git clone <this repo> && cd claude-cloud
cp .env.example .env
# edit .env: set POSTGRES_PASSWORD (and the same value inside DATABASE_URL),
# AUTH_SECRET (openssl rand -base64 48) and SEED_PASSWORD
docker compose up --build
```

Open http://localhost:3000. On start the app applies migrations, seeds reference data (stages, sources, lost
reasons, objections, cadence templates) and four accounts. Set `SEED_DEMO=true` in `.env` if you want 20 demo leads
to try every screen (off by default; owners can remove them later in Settings > Integrations). All of it is idempotent: restarting is safe.

| User | Email | Role |
| --- | --- | --- |
| Retro | retro@orladent.local | owner |
| Badr | badr@orladent.local | owner |
| Sayed | sayed@orladent.local | owner (admin) |
| Mo | mo@orladent.local | finance (payments, revenue export) |

Everyone starts with the `SEED_PASSWORD` from `.env` and is asked to set their own under **My account** (top
right). Roles are explained in the User guide. Owners manage users in **Settings > Users**.

## Configuration (`.env`)

See `.env.example`, which explains every value. The important ones:

| Variable | Meaning |
| --- | --- |
| `POSTGRES_PASSWORD`, `DATABASE_URL` | Database password, and the URL the app uses (same password) |
| `AUTH_SECRET` | 32+ random characters that sign session cookies and seal two-factor secrets. Changing it signs everyone out and requires every two-factor to be reset (Settings > Users) |
| `SEED_PASSWORD` | Initial password of the four seeded accounts |
| `SEED_DEMO` | `true`: add demo leads on first start into an empty database. Default `false` (real use) |
| `COOKIE_SECURE` | `true` when served over HTTPS (production compose forces it) |
| `DOMAIN` | Production only: the domain Caddy gets a certificate for |
| `INBOUND_LEADS_TOKEN` | Optional. 24+ random characters; switches on `POST /api/inbound/leads` for Meta lead ads through Zapier or Make (User guide > Growth) |
| `NOTION_TOKEN` | Optional. Switches on the two-way Notion sync (Batches, Candidates, Ledger, Sessions, Proof bank, Team, CRM Leads). Setup: User guide > Notion |
| `NOTION_*_DB`, `NOTION_SYNC_LEADS`, `NOTION_SYNC_INTERVAL_SEC`, `APP_URL` | Optional Notion settings, explained in `.env.example` |

Secrets live only in `.env`, which is git-ignored.

## Development

```bash
docker compose up -d db          # database only (publish port 5432 locally if you need it)
npm install
export DATABASE_URL=postgres://crm:<pw>@localhost:5432/crm AUTH_SECRET=<32+ chars> SEED_PASSWORD=<pw>
npm run db:setup                 # migrate + seed
npm run dev
```

| Command | What it does |
| --- | --- |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript |
| `npm test` | Unit and integration tests (integration tests need `TEST_DATABASE_URL`, see below) |
| `npm run build && npm run test:e2e` | Real-browser end-to-end and accessibility tests |
| `npm run db:generate` | Create a migration from `src/db/schema.ts` into `drizzle/` (commit the result) |
| `npm run db:migrate` / `db:seed` | Apply migrations / seed |
| `npm run backup` | Take a database backup (see below) |

### Tests

* **Unit tests** always run: conversion maths, phone and CSV handling, roles, sessions, headers.
* **Integration tests** run when `TEST_DATABASE_URL` points at a scratch Postgres (it is emptied and rebuilt, so
  never point it at real data): `TEST_DATABASE_URL=postgres://postgres@localhost:5432/crm_test npm test`. They
  cover the whole database layer, the server actions for every role, the dashboard against a hand-checked
  20-lead dataset, and a 10,000-lead performance run.
* **End-to-end tests** (`e2e/`) drive the built app in a real browser: the add lead, book consult, enrol
  journey; the password change flow; and automated accessibility checks (axe) of every screen in both themes.
  They use their own scratch database (`E2E_DATABASE_URL`, default `crm_e2e`) and need the Playwright browsers.

## Backups and restore

Backups are custom-format `pg_dump` files, written `0600` in a `0700` folder (`./backups` by default). They
contain students' personal data: keep them private and encrypt any copy that leaves the machine.

```bash
scripts/backup.sh                         # one backup now; keeps the newest 14 (BACKUP_KEEP)
```

A backup only counts if the file can be read back as an archive containing the core tables; a failed run exits
non-zero, leaves no half-written file and never removes a good backup.

**Nightly:** install the cron line from `scripts/backup-cron.example` (`crontab -e`), then also copy the newest
file somewhere off the server (another machine or object storage), encrypted, for example
`age -r <public-key> -o crm.dump.age backups/crm-….dump`. A backup on the same disk does not survive the disk.

**Restore drill (safe, do it regularly):** proves a backup restores without touching live data. It restores into
a throwaway database, compares row counts with live, and drops it:

```bash
scripts/verify-restore.sh backups/crm-20260929T023000Z.dump     # ends with "RESTORE DRILL OK"
```

**Restore (replaces all data):** all or nothing in one transaction, and it asks you to type `RESTORE`:

```bash
scripts/restore.sh backups/crm-20260929T023000Z.dump            # stops the app, restores, starts it again
scripts/restore.sh backups/crm-….dump --into crm_inspect --yes # restore into another database to look at it
```

The scripts run inside the `db` container of `docker compose` by default. To run them straight against a
database (no Docker), set `BACKUP_MODE=direct DATABASE_URL=postgres://…` and have the PostgreSQL client tools
installed. Both modes share the same code.

## Deploy to a VPS (HTTPS)

You need a server with Docker, a domain whose DNS points at it, and ports 80 and 443 open.

1. Clone the repo on the server and create `.env` (`cp .env.example .env`). Set strong values for
   `POSTGRES_PASSWORD`, `AUTH_SECRET` and `SEED_PASSWORD`, set `DOMAIN=crm.example.com`, and set
   `SEED_DEMO=false`.
2. Start it: `docker compose -f docker-compose.prod.yml up -d --build`. Caddy obtains and renews the HTTPS
   certificate by itself. Only Caddy is exposed; the app and the database are not reachable from outside.
3. Sign in, open **My account** and set your own password. In **Settings > Users** add real people, set their
   roles, and deactivate or reset the seeded accounts you don't need.
4. Install the nightly backup (above) and run one restore drill.
5. Update later with `git pull && docker compose -f docker-compose.prod.yml up -d --build`. Migrations apply on
   start.

Notes for production: the app must be reached only through the reverse proxy (it reads the client address from
the proxy's header for the login rate limit); keep Postgres unpublished; `COOKIE_SECURE=true` and HSTS are on.

## Privacy and security in one page

* The database holds students' personal data. Serve it only over HTTPS, use a strong password for every
  account, and do not share CSV exports (leads, revenue) casually: exports are logged in the audit log.
* Sign-in: passwords are hashed with bcrypt; sessions are signed httpOnly cookies; only **failed** sign-ins
  count towards the limit (5 per account and address, 20 per address, per 15 minutes); changing or resetting a
  password signs that user out everywhere.
* Every write is checked on the server against the user's role, not just hidden in the UI; changes to roles or
  deactivation take effect on the next click.
* Cross-site request forgery: SameSite cookies plus an Origin check on every write. Security headers include a
  strict Content-Security-Policy, `X-Frame-Options: DENY` and HSTS.
* Server logs never contain lead data: database errors are scrubbed before they are logged, and the audit log
  records who did what to which record, never names, numbers or message text.
* Notion: when `NOTION_TOKEN` is set, batches, candidates, the ledger and leads (name, phone, email, stage,
  notes) are copied to the camp's Notion workspace, so everyone with access to those Notion pages sees them.
  `NOTION_SYNC_LEADS=true` is the owners' choice; set it to `false` to keep leads out. The token stays on the
  server; payment references never leave the CRM, and team pay or equity never comes into it.
* Dependencies: `npm audit --omit=dev` reports no known vulnerabilities. Re-run it (and update) periodically.
