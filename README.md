# OrlaDent Camp CRM

Self-hosted, lead-and-sales CRM for OrlaDent Camp course sales (Egypt, EGP, Cairo time). Never lose a lead,
always know who to contact today, and see where the funnel leaks. Next.js 15 + PostgreSQL 16, one
`docker compose up`.

It is also the company's **HQ**: spaces for each area of the business, lists of tasks with List, Board,
Calendar and Table views, subtasks, a personal Home, an Inbox and docs (see the user guide).

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
| `ANTHROPIC_API_KEY` | Optional. Lets the AI assistant run (Ask OrlaDent, drafts, consult briefs); an owner must still switch it on in Settings > AI assistant. `AI_MODEL` overrides the model (default `claude-opus-5-5`). See User guide > The AI assistant |
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

## Deploy on Vercel + Supabase (the chosen setup for internal testing)

Vercel runs code only when a request comes in, so the parts of the app that run on their own are moved out:
the 5-minute background work is called by Supabase's scheduler, and the daily backup runs as a GitHub Action.

1. **Supabase**: the project (ORLADENT HQ, Ireland). From **Connect**, copy two URLs, with a database password of
   letters and digits only (or URL-encode it):
   - **Transaction pooler** (port 6543): the app's `DATABASE_URL`.
   - **Session pooler** (port 5432): `MIGRATE_DATABASE_URL` (database updates during the build) and the backup.
2. **Vercel**: Add New > Project > import this repository. `vercel.json` sets the build (database updates on
   production deploys only, then `next build`) and the region (Dublin, next to Supabase). Environment variables:

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | the transaction pooler URL (6543) |
   | `MIGRATE_DATABASE_URL` | the session pooler URL (5432) |
   | `DATABASE_POOL_MAX` | `5` (not 1: with one connection a page's parallel queries can stall) |
   | `AUTH_SECRET` | `openssl rand -base64 48` |
   | `SEED_PASSWORD` | the first password of the seeded accounts |
   | `COOKIE_SECURE` | `true` |
   | `APP_URL` | `https://<project>.vercel.app` (or your domain) |
   | `CRON_SECRET` | `openssl rand -hex 32` |
   | `BACKUP_IN_APP` | `false` (Vercel has no `pg_dump`; the GitHub Action takes the backup) |
   | `NEXT_PUBLIC_MAX_UPLOAD_MB` | `4` (Vercel refuses uploads above about 4.5 MB) |
   | optional | `NOTION_TOKEN`, `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`, `ANTHROPIC_API_KEY` |

3. **The 5-minute work** (workflow rules, forgotten clocks, files to Drive, email digests, reminders, the Notion
   sync): in Supabase, **SQL Editor**, run once, with your app's address and `CRON_SECRET`:

   ```sql
   create extension if not exists pg_cron;
   create extension if not exists pg_net;
   select vault.create_secret('<CRON_SECRET>', 'hq_cron_secret');
   select cron.schedule('hq-tick', '*/5 * * * *', $$
     select net.http_post(
       url := 'https://<project>.vercel.app/api/cron/tick',
       headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'hq_cron_secret')),
       timeout_milliseconds := 60000);
   $$);
   ```

   `select * from cron.job_run_details order by start_time desc limit 5;` shows the last runs. Vercel's own cron
   (free plan: once a day) calls the same address at 03:07 UTC as a fallback.
4. **Backups**: connect Google Drive in the app (Settings > Integrations). In GitHub, Settings > Secrets and
   variables > Actions, add `BACKUP_DATABASE_URL` (the session pooler URL), `AUTH_SECRET` (the same as Vercel's),
   and the Google variables set on Vercel. The **Backup** workflow then saves a `pg_dump` to the Drive Backups
   folder every night and keeps the newest 14; run it by hand from the Actions tab.
5. **Domain** (optional): Vercel project > Settings > Domains > `hq.orladent.com`; at Hostinger add the CNAME
   Vercel shows.

Limits on Vercel: files up to 4 MB; login attempt limits are counted per running copy of the app, so they are
looser than on one server (two-factor sign-in is unaffected); a background round that takes longer than 60
seconds is cut off and finishes on the next one (the Notion sync works in batches). The free plan is for
non-commercial use: fine for testing with the team, move to Pro or a server for the business.

## Deploy on Render + Supabase (always on, no changes needed)

1. **Supabase**: create the project (done: ORLADENT HQ, Ireland). Copy **Connect > Session pooler** (port 5432);
   use a database password with letters and digits only, or URL-encode it.
2. **Render**: New > Blueprint > this repository. `render.yaml` defines the `orladent-hq` web service (Docker,
   Frankfurt, free plan, health check `/api/health`, auto-deploy from `main`). Render asks for the secrets:
   `DATABASE_URL`, `SEED_PASSWORD`, and optionally `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, `RESEND_API_KEY`,
   `ANTHROPIC_API_KEY`. `AUTH_SECRET` is generated. Render needs a payment card on the account even for the free plan.
3. **Domain**: in the service, Settings > Custom Domains > add `hq.orladent.com`; at Hostinger add a CNAME `hq` →
   `orladent-hq.onrender.com`. Render issues the certificate.
4. **Backups**: Supabase's free plan keeps none. Once Google Drive is connected (Settings > Integrations), the app
   saves a `pg_dump` to a Backups folder in that Drive once a day and keeps the newest 14; **Back up now** runs one
   on demand. On the free Render plan the app sleeps when idle, so the daily backup runs the next time it wakes.
   Restore: download a file, then `pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL" orladent-hq-….dump`
   (with PostgreSQL 17 client tools).

## Deploy without a server: Hostinger + Supabase + Google Drive

No VPS and no Docker: the app runs as a Node.js web app (Hostinger Business or Cloud plans, or any Node host),
the database is Supabase's Postgres, and uploaded files go to Google Drive.

1. **Supabase.** Create a project (region close to Cairo, for example Frankfurt). In **Connect**, copy the
   **Session pooler** connection string (port 5432, IPv4) and put your database password in it. Optional but
   recommended: in **Project Settings > Data API**, switch the Data API off; the app does not use it. On every
   start the app also turns on row level security for every table, so the API could not read them anyway.
2. **Google Drive** (optional; without it files stay in the database). In Google Cloud Console create a project,
   enable the **Google Drive API**, set up the OAuth consent screen (External, then **Publish app**: the app asks
   only for `drive.file`, which needs no Google review, and a published app's sign-in does not expire after 7
   days), and create an **OAuth client ID** of type *Web application* with the redirect URI
   `https://<your subdomain>/settings/integrations/drive/callback`.
3. **Hostinger.** In hPanel: **Websites > Add website > Node.js web app**, connect GitHub and pick this
   repository and `main`. Build command `npm run build`, start command `npm start`, Node 20 or newer. Add the
   environment variables:
   `DATABASE_URL` (step 1), `AUTH_SECRET` (`openssl rand -base64 48`), `SEED_PASSWORD`, `COOKIE_SECURE=true`,
   `MIGRATE_ON_START=true`, `APP_URL=https://<your subdomain>`, and from step 2 `GOOGLE_CLIENT_ID` and
   `GOOGLE_CLIENT_SECRET`. Attach your subdomain to the app; Hostinger issues the certificate.
4. Open the site, sign in, set your own password (step 3 of the VPS guide below). Then **Settings >
   Integrations > Connect Google Drive** and pick the account that should keep the files. The app creates an
   "OrlaDent OS files" folder there and can see nothing else in that Drive. Files already in the database move to
   Drive by themselves, a few every 5 minutes, or at once with **Move them to Drive now**.
5. Updates: push to `main`; Hostinger rebuilds and restarts, and migrations apply on start.

What changes compared with the VPS setup:

* **Backups.** `scripts/backup.sh` is written for Docker. Supabase backs the database up daily (keep in mind the
  free plan's limits); for your own copy run `BACKUP_MODE=direct DATABASE_URL=… scripts/backup.sh` from any
  computer with the PostgreSQL client tools. Files in Drive are covered by Drive (deleted files go to Drive's bin).
* **Background jobs** (rules that run on a timer, stopping forgotten clocks at midnight, the Notion sync, moving
  files to Drive) run inside the app every 5 minutes. They run only while the app is up; if your host puts idle
  apps to sleep, they catch up when it wakes.
* **Files** are read through the app, which checks permissions and logs every download. They are never shared
  from Drive. Disconnecting Drive keeps the files there, but the app can open them again only after the same
  account is reconnected.

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
