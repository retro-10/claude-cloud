# OrlaDent Camp CRM

Self-hosted, lead-and-sales CRM for OrlaDent Camp course sales. Next.js + PostgreSQL, runs with one `docker compose up`.

Status: **Phase 2 (leads)**. See the phase plan in the project brief.

## Run it (about 5 minutes)

Requirements: Docker with Compose v2.

```bash
git clone <this repo> && cd claude-cloud
cp .env.example .env
# edit .env: set POSTGRES_PASSWORD (and the same value inside DATABASE_URL),
# AUTH_SECRET (openssl rand -base64 48) and SEED_PASSWORD
docker compose up --build
```

Open http://localhost:3000 and sign in with a demo user. On start the app applies migrations and seeds reference data (stages, sources, lost reasons, objections, cadence templates) and three users. The seed is idempotent, so restarts are safe.

| User | Email | Role |
| --- | --- | --- |
| Retro | retro@orladent.local | owner |
| Badr | badr@orladent.local | owner |
| Murail | murail@orladent.local | viewer |

Password for all three is `SEED_PASSWORD` from your `.env`.

## Develop without Docker for the app

```bash
docker compose up -d db          # database only (publish port 5432 locally if needed)
npm install
export DATABASE_URL=postgres://crm:<pw>@localhost:5432/crm AUTH_SECRET=<32+ chars> SEED_PASSWORD=<pw>
npm run db:setup                 # migrate + seed
npm run dev
```

## Commands

| Command | What it does |
| --- | --- |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript |
| `npm test` | Unit tests. Integration tests run when `TEST_DATABASE_URL` is set. |
| `npm run db:generate` | Generate a migration from `src/db/schema.ts` into `drizzle/` |
| `npm run db:migrate` / `db:seed` | Apply migrations / seed |

Integration tests **drop and recreate the public schema** of `TEST_DATABASE_URL`. Use a scratch database.

## Still to come
Backup and restore, VPS deployment notes and the user guide are written in Phase 8.

## Privacy
The database holds students' personal data. Once off your local machine, serve it only over HTTPS, set `COOKIE_SECURE=true`, use a strong password for every account, and do not share CSV exports casually.
