# Decisions

## Stack
- **Next.js 15 (App Router) + React 19 + TypeScript + Tailwind 3.** One deployable, server actions for writes, no separate API layer to maintain. Started on Next 14; moved to 15.5.26 in Phase 8 because 14.x has known critical and high vulnerabilities with no patch on that line (see Phase 8). Tailwind stays on 3 for stability.
- **PostgreSQL 16 + Drizzle ORM (postgres-js driver).** SQL-first, migrations are plain SQL files in `drizzle/` and are checked in. The dashboard needs window functions, medians and `percentile_cont`, which are easier to write with Drizzle's `sql` escape hatch than in Prisma.
- **Custom session auth instead of Auth.js.** Credentials login with bcrypt plus a signed JWT (`jose`) in an httpOnly, SameSite=Lax cookie. Reason: Auth.js credentials flow adds an adapter and a beta-version surface for a three-user tool. `getCurrentUser()` re-reads the user row on every request, so deactivating a user or changing their role takes effect immediately.
- **bcryptjs (cost 12)** rather than argon2: pure JS, no native build step in the Alpine image. Allowed by the brief (argon2 or bcrypt).
- **Login rate limit is in-memory.** Correct for one app instance. If the app is ever scaled out, move it to Postgres.
- **CSRF:** Next.js server actions check the Origin header against Host, and the session cookie is SameSite=Lax. Any plain route handlers added later (CSV export is a GET) must be read-only or check Origin themselves.

## Data model choices (review at Gate A)
- `leads.stage` and `stage_events.from_stage/to_stage` store the stage **key** (stable), not the id, so relabelling or reordering stages never rewrites history. Keys are not editable in settings; only label and position are.
- A lead creation writes a `stage_events` row with `from_stage = NULL, to_stage = 'new'`, so the funnel's first step counts every lead.
- `consults.objection_tags` from the brief is a join table `consult_objections` so tags can be counted with a plain `GROUP BY`.
- `follow_ups.template_id` set = created by a cadence. The stop rule sets `cancelled_at` on open rows with a template; manual follow-ups are never cancelled by it. Rows are cancelled, not deleted, to keep history.
- `leads.deleted_at` implements soft delete. The unique index on lower(email) only covers live leads, so a deleted lead does not block re-adding the person. `phone_whatsapp` is unique across all rows including deleted ones, so restoring is always safe; the duplicate check will offer to restore instead.
- Extra columns not in the brief: `leads.updated_at`, `users.created_at`, `follow_ups.cancelled_at`, `activities.external_id` (for future imported messages), and a `saved_views` table (needed for saved views in 4.1).
- `tier` (enrolments) is a strict enum of the three paid tiers; `tier_interest` on leads also allows `unsure`.
- Enrolment is unique per (lead, cohort).
- Timestamps are `timestamptz`, stored in UTC. The DB and containers run with `TZ=UTC`; conversion to `Africa/Cairo` happens only when rendering or when computing "today" boundaries.
- Amounts are integer EGP (no fractions).

## Fonts
(Superseded by the Camp brand below: now Archivo and Bodoni Moda.) Inter and Playfair Display load from Google Fonts in the browser. The app runs without them (falls back to system fonts), so nothing needs the network to start. To self-host later, drop the font files in `public/` and replace the `@import` in `globals.css`.

## Seed users
The seed creates Retro, Badr and Sayed (all `owner`) and Mo (`finance`) with emails `@orladent.local` and one shared password from `SEED_PASSWORD`. Badr has "final say", so he is an owner. "Admin" (Sayed) is mapped to `owner`, the role that can do everything. Replace emails and passwords before real use (see `QUESTIONS.md`).

Murail was removed. `REMOVED_USERS` in `seed-data.ts` lists accounts the seed must not leave behind: it deletes them, or, if they already have history pointing at them, deactivates them (login blocked, history kept). Removing a name from `DEMO_USERS` alone would not remove it from an existing database.

`finance` is a fourth role added for Mo (migration `0001`). Agreed scope (not built yet, needs the revenue screens): see revenue and enrolments, record and edit payments, export revenue; no editing of leads or settings. Until Phase 6/7 it is read-only, identical to `viewer`.

## Phase 2 (leads)
- **Duplicate handling blocks, it does not merge.** Quick add and edit refuse a phone or email that another lead already has and link to the existing lead (including soft-deleted ones, which must be restored, not re-created). Phones are normalised to E.164 first, so `010…`, `+20 10…` and Arabic-Indic digits all match. Numbers without a country code are assumed Egyptian.
- **Logging activity does not move the stage.** The first outbound message stamps `first_contact_at` and the first inbound stamps `first_reply_at`, but the stage only changes when someone moves it. Auto-advancing `new` to `contacted` is easy to add if wanted (see QUESTIONS.md).
- **Only contact-type activities count** for those timestamps: whatsapp, call, instagram, linkedin, email. Internal notes and consult records do not.
- **"Won" needs an enrolment.** Until Phase 4, the stage selector refuses `enrolled`; `lost` requires a lost reason, enforced in the service layer (`changeStage`), not only the UI.
- **Speed badge is rendered at page load**, not a live ticking timer. Amber from 5 minutes, red from 30.
- **Audit log stores field names and ids, never lead values**, to keep personal data out of it.
- `next build` runs without `DATABASE_URL` (the DB client connects lazily); at runtime a missing URL is fatal.

## Phase 3 (import/export)
- **Own CSV parser** (RFC 4180, BOM, quotes, `,` `;` tab sniffing) instead of a dependency; unit-tested including Arabic round trips.
- **Preview is a real run rolled back.** The dry run executes the whole import inside a transaction and throws to roll back, so preview counts are exactly what the real import will do.
- **Existing people are matched on phone or email** (including soft-deleted ones, which are reported, not recreated). A row matching two different leads is refused. Updates fill blanks only and never overwrite.
- **Imported leads get real history:** `created_at` from the file (day-first dates, ISO, or epoch ms) and `stage_events` written at that date, so funnel numbers include them. Stages `enrolled` and `lost` cannot be imported (no enrolment / reason): they fall back to `new` and count as a warning. Unknown source labels are left blank (warning), not auto-created.
- **A row with an invalid phone and no email is skipped**, because it could not be de-duplicated on re-import.
- **Export escapes formula-like cells** (`=`, `@`, and `+`/`-` that aren't plain numbers or phones) with a leading apostrophe, which import strips again. Export is a GET, audited (count only), and needs `lead:read`.

## Phase 4 (pipeline, enrolment)
- **One stage-move code path** (`moveStageTx`) used by the detail page, the board and enrolment, so `stage_events` cannot be skipped.
- **Enrolment and the move to `enrolled` are one transaction.** The cohort row is locked first, so two simultaneous enrolments cannot both take the last seat (tested). Over-cap enrolment is allowed only with an explicit override, only for owners, and is audited as `create_over_cap`.
- **An enrolled lead cannot be moved back.** Otherwise revenue rows would point at a lead that is no longer enrolled. There is no "cancel enrolment" yet (see QUESTIONS.md).
- **Board shows up to 100 cards per column** (newest activity first); the column badge always shows the true total. "Days in stage" comes from the latest `stage_events` row into that stage.
- **Touch devices:** HTML5 drag and drop does not work on phones, so every card also has a "Move to…" menu that goes through the same prompts.

## Phase 5 (Today, follow-ups, cadences)
- **"Today" and "overdue" are Cairo calendar days, not rolling 24 hours.** Overdue = due before 00:00 Cairo today; due today = between 00:00 and 24:00 Cairo. A follow-up due at 09:00 that is still open at 15:00 is "due today", not overdue. The lead-list "overdue" filter and the pipeline's overdue marker use the same rule.
- **Follow-ups created from a date get 09:00 Cairo.** A cadence's day 0 is the Cairo date it is applied; each step is day 0 + `offset_days` at 09:00 Cairo. Dates are calendar arithmetic, so a cadence that crosses Cairo's daylight-saving change or a month end does not shift a day (tested across 30 Oct 2026).
- **Stop rule lives in the service layer** (`logActivity` for inbound contact-type activity, `moveStageTx` for won/lost), so no screen can bypass it. It cancels only follow-ups that came from a template; manual ones and already-done ones are untouched. Cancelled rows are kept (`cancelled_at`). `nurture` does not stop a cadence.
- **A cadence cannot be started twice** while its follow-ups are still open on the same lead, nor on won or lost leads. A different cadence can run alongside.
- **`message_hint` is stored in the follow-up's `note`** and only displayed. Nothing is sent.
- **Today shows everyone's work by default** with a "Show only mine" toggle. "Uncontacted" = no `first_contact_at` and the stage is an open one, oldest first.
- **"Sent" on Today** logs an outbound WhatsApp activity (which sets first contact and feeds speed-to-lead); it is a record of something the user did by hand, not a send.
- **Bulk actions** (stage, owner, cadence; max 500) run per lead: one failure never blocks the rest, and the result says how many were done and why others were skipped. Bulk cannot mark leads Enrolled.

## Phase 6 (consults, cohorts, payments)
- **Consults keep the pipeline in step, forward only.** Booking moves a lead to `consult_booked`, and marking it held moves it to `consult_held`, but only if the lead is in an *open* stage that comes earlier. A lead already at `offer_sent`, or in nurture/lost/won, is left alone. Marking held requires an outcome (`enrolled`, `thinking`, `not_fit`); "no-show" sets `held = false`, outcome `no_show`. Outcome `enrolled` does not enrol anyone: enrolment is still done from the Pipeline so amount and cohort are captured.
- **Consult results are logged as internal `consult` activities**, which never count as first contact.
- **Re-marking a consult replaces its objection tags**; a no-show clears them.
- **Revenue is the sum of enrolment amounts ("booked"); "collected" is the part with a paid date.** Both are shown on the cohort page.
- **The seat cap cannot be lowered below the seats already taken**, and over-cap enrolment stays owner-only and audited (Phase 4).
- **Finance role (Mo):** can edit payment details (tier, amount, paid date, reference, gateway) on an existing enrolment and export a cohort's enrolments. Cannot create enrolments, edit leads, or change settings. Cohorts themselves are created and edited by owners (`settings:write`). Payment audit entries record field names, never values.
- **Everyone who can read can see revenue.** The brief does not say to hide it from sales or viewers, so it is not hidden. Cohort and lead CSV exports: the cohort export needs owner/finance; the lead export needs only read access (see QUESTIONS.md).

## Phase 7 (dashboard)
Every number is computed in SQL (`src/lib/metrics.ts`) from `stage_events`, consults and enrolments, never from a lead's current stage (tested by changing current stages and checking the funnel does not move).
- **Filters choose leads; metrics follow those leads.** Date range = lead *created* in the range (Cairo dates, end day inclusive); source, campaign, segment and owner match the lead; cohort = leads enrolled in that cohort. All metrics except the weekly trend are then computed over that set and their whole history. The weekly trend counts events in the week they happened (lead created, consult scheduled, first enrolment). Weeks start Monday, Cairo time. The default view is the last 90 days; "All time" removes the range.
- **Funnel** = distinct leads with at least one `stage_events` row into each stage of the main path (open stages, then the won stage), and conversion = count / count of the previous step. `lost` and `nurture` are shown as side counts, not steps. A lead that skipped a stage (for example moved straight to Replied) does not count as having reached the skipped one; that is what "ever reached" means literally.
- **Speed:** median minutes creation to first contact, over contacted leads only. "Within 5 minutes" (5:00 or less) uses **all** leads in scope as the denominator, so a lead nobody has contacted counts against you.
- **Consults:** booked = all consult rows; held; no-show; "still to happen" (future, no result); "awaiting a result" (time passed, nothing recorded), which sum to booked. **Show-up rate = held / (held + no-show)**, so consults not yet resolved are left out. **Consult-to-enrolment** = held-consult leads that have an enrolment / held-consult leads.
- **Sales cycle:** median days from lead creation to the first move into the won stage.
- **Revenue:** sum of enrolment amounts (booked), with the paid part shown as collected; by tier, cohort and source. Totals are tested to equal the sum of the enrolment rows in every grouping.
- **Leaks:** top 5 lost reasons (from leads currently in a lost stage) and top 5 objection tags (from consults); ties are broken alphabetically.
- **Small samples:** a rate whose denominator is under 5 shows "n of N" instead of a percentage; with 0 records it shows a dash. Medians are always shown, with the record count beside them where the screen has room.
- **Demo dataset** (`src/db/demo-data.ts`): 20 leads created so every answer can be checked by hand. The tests assert those answers exactly (funnel 20/18/13/11/9/7/5, median first contact 7 min, 8 of 20 within 5 min, show-up 9 of 10, consult-to-enrolment 5 of 9, median cycle 10 days, revenue 60,000 EGP, and so on). The same dataset, shifted to end near today, is what `SEED_DEMO=true` loads.


## Phase 8 (hardening, admin, operations)

### Gap found and closed
Section 4.7 (settings and admin) had not been built in earlier phases: only the tables and audit helper existed.
Phase 8 adds: users and roles (create, change role, deactivate, reset password, always at least one active owner),
stage rename/reorder, sources / lost reasons / objection tags / campaigns (a label in use can be renamed, not
deleted), cadence-template editing, the owner-only audit log page, and My account (change own password).
Stage *keys* and kinds stay fixed (new stages cannot be added or removed): they carry behaviour (won needs an
enrolment, lost needs a reason), and the brief asks only for label and order to be editable.

### Security
- **Dependency upgrade.** `npm audit` on Next 14.2.35 (the last 14.x) reported 2 critical and several high advisories
  fixed only from 15.5.24: remote code execution through the image optimizer, denial of service in Server
  Components and Actions, request forgery. Upgraded to Next 15.5.26, React 19, Drizzle 0.45.3 (a SQL-injection
  advisory in identifier escaping; our code only passes whitelisted identifiers, so it was not exploitable, but it is
  patched) and pinned Next's bundled PostCSS to a patched version. `npm audit --omit=dev` now reports **0**. The 8
  remaining findings are development-only tools (test runner and dev servers) that never run in production. The
  image optimizer is also switched off (`images.unoptimized`): the app does not use it, and `/_next/image` now returns 404.
- **Password change invalidates sessions.** The session token carries a fingerprint of the password hash; changing
  or resetting a password (or deactivating the user) makes every older cookie useless on the next request.
- **Login limit counts failures only** (5 per account+address, 20 per address, per 15 minutes; configurable). It used
  to count successful sign-ins too, which would lock out a normal user. In-memory, correct for one app instance.
- **No redirect loop for stale cookies.** The middleware only gates *unauthenticated* visitors; the login page decides
  server-side whether a cookie is really valid. (A signed but stale cookie used to bounce between `/` and `/login`.)
- **CSRF:** SameSite=Lax cookies, Next's own server-action Origin check, plus an Origin/host check on every write in
  the middleware (understands `X-Forwarded-Host` behind the proxy).
- **Headers** set in the middleware (so HSTS follows `COOKIE_SECURE` at runtime): strict Content-Security-Policy
  (`default-src 'self'`, Google Fonts as the only third party, `frame-ancestors 'none'`), `X-Frame-Options`,
  `nosniff`, `Referrer-Policy`, `Permissions-Policy`. Inline scripts remain allowed because Next needs them; a
  nonce-based policy is a possible later tightening.
- **No lead data in logs.** Database errors carry the query parameters and "Key (phone)=(+20…)" detail. Drizzle 0.45
  wraps driver errors, which also broke duplicate detection until the SQLSTATE lookup followed `cause` (caught by
  tests). Every `console.error` is now scrubbed (`instrumentation.ts`, `src/lib/redact.ts`), unique-violation races on
  create/update are turned into the normal "duplicate" answer, and the audit log stores field names and ids only.
  Verified on the running server: a failed insert with a real name and phone left neither in the log.
- **Page vs action permission checks.** Actions throw `Forbidden` (only reachable by a crafted request); pages use
  `requirePageCan`, which shows "Not found" (no error, no data) because Next can render a page in parallel with its layout.
- **Static guards** (`tests/guards.test.ts`) fail the build if a server action or route handler lacks a permission check,
  if a settings page lacks its own check, if source uses `console.*`, or if an audit diff names personal fields.

### Operations
- **Backups:** `scripts/backup.sh` (custom-format `pg_dump`, verified readable before it is kept, `0600` in `0700`,
  retention), `scripts/restore.sh` (all-or-nothing, typed confirmation, stops and restarts the app in Docker mode),
  `scripts/verify-restore.sh` (restore drill into a scratch database). Two modes share one code path: `docker compose exec`
  (default) and `BACKUP_MODE=direct`.
- **Production stack:** `docker-compose.prod.yml` + `Caddyfile`: automatic HTTPS, only Caddy published, `COOKIE_SECURE`
  forced on, demo data off by default. The image runs as the unprivileged `node` user and has a healthcheck
  (`/api/health`, which also checks the database).
- **Fonts** load through a non-blocking `<link>` with `font-display: swap` instead of a render-blocking CSS `@import`.
  Self-hosting them would remove the last third-party request; it needs the font files at build time, so it is left as a
  follow-up (QUESTIONS.md).
- **Performance caps:** Today shows the first 50 rows of each section (count badge shows the true total); the board shows
  the 40 most recently active cards per column. Both were far slower with 10,000 leads before the caps.
- **Accessibility:** colours are theme tokens (the light theme uses darker gold/amber/red/green so text keeps 4.5:1),
  visible focus ring, skip link, labelled landmarks, per-page titles, reduced-motion support, error and not-found pages.

### What was verified, and how
| Claim | How it was checked | Result |
| --- | --- | --- |
| Migrations apply to an empty database; seed is idempotent | integration test + real runs | passes |
| Role rules enforced on the server | every server action and route handler called with a real signed cookie for each role, allowed and refused sides, plus "refused changes nothing" and stale-cookie cases | 24 tests pass |
| Add lead, book consult, enrol, see it on the dashboard | real-browser end-to-end test on the production build | passes |
| Dashboard numbers | hand-worked answers from a fixed 20-lead dataset, asserted exactly | passes |
| Lead list and dashboard under 1 s with 10,000 leads | database time (list 6 ms, dashboard 47 ms, board 97 ms, Today 27 ms, full export 84 ms) and browser time to visible content (list about 180 ms, dashboard about 140 to 175 ms, Today about 310 ms, pipeline about 345 ms) | passes |
| Backup and restore | real backup of the 10,000-lead database; database wrecked; restored; checksum over all leads identical; corrupt files refused; failed backup exits non-zero and leaves no partial file; retention; restore drill | passes |
| Accessibility | axe (WCAG 2.1 A/AA) on every screen and both open dialogs, dark and light, plus keyboard checks | 0 violations |
| No lead data in logs | unit tests on the scrubber, plus a deliberately broken database and a real form submission on the running server | 0 occurrences |
| **`docker compose up`, the Dockerfile and `docker-compose.prod.yml`** | **not run: the environment this was built in has no Docker daemon.** The same steps were run by hand (migrate, seed, build, start, login) and the compose files are standard, but please run `docker compose up --build` once and, for production, the prod file on the real server | **unverified** |
| HTTPS, certificate issuance, HSTS end to end | headers verified on the running server; Caddy and real certificates not run | **unverified** |
| Assistive-technology use (screen reader) | only automated checks and keyboard tests; automated tools find roughly a third of issues | **partly verified** |

## Release 1.1: design and discipline

**Interface.** A new design system (`src/app/globals.css`, `src/components/ui`): warm charcoal surfaces, warm
white text, one gold accent (the brief's palette), Playfair Display for titles, Inter for everything else,
hairline borders, soft shadows. A fixed sidebar with live counts replaces the top bar; a mobile bottom bar and
drawer; a command palette (Ctrl/⌘K) searching leads and commands; `g`-key navigation and a `?` shortcut sheet;
toasts for saved notices. Icons are inline SVG (no icon font, no network). Charts are server-rendered HTML with
one hue, focusable marks with tooltips and a table view; the weekly trend is three small multiples instead of
three series on one scale. Both themes pass the automated WCAG AA scan on every screen and dialog.

**Exit criteria (P1)** are checked in `moveStageTx`, the one function every stage change goes through (board,
lead page, bulk, consults, enrolment), so no path can skip them. Checks are code (`src/lib/exit-criteria.ts`);
which apply to which stage is data (`stage_exit_criteria`), edited in Settings. Checks apply to the stage being
entered. Owners may override with a reason (audit-logged). Automatic moves (consult booked/held) simply wait.
CSV imports of past data skip the checks and the rules: they record history, not a move.

**Workflow rules (W1)** run inside the same transaction as the event that triggers them, so a lead is never
created without its reply task. Time-based rules (overdue, response time breached) are swept every 5 minutes in
the server process and on each Today load (in the background); each fires at most once per follow-up or lead
(`workflow_runs.dedupe_key`). Rules can create follow-ups, stop cadences, cancel follow-ups, tag, assign and
notify. They never send a message. The "they replied" rule stops only cadence steps: hand-made follow-ups stay.

**Smart views** are one SQL condition each (`src/lib/views.ts`) used by the list and the badges. The sidebar
counts run on every page, so they use one aggregated query (65 ms at 10,000 leads, down from 795 ms with the
per-row form); a test checks every count equals its list's total.

**Templates** never contain typed dates (refused on save): every deadline comes from the cohort or lead record
(E2). Missing placeholder values block sending instead of sending blank text. The composer opens `wa.me` with
the text; the user confirms it was sent, which logs it.

**Phone numbers (D1).** Egyptian numbers must be a valid mobile (10, 11, 12, 15 + 8 digits) or landline length;
the text as typed is kept in `phone_raw`. **Duplicates (D2)**: phone or email block; same name and city warn;
name only does nothing. Search folds Arabic spelling variants (أ/إ/آ/ا, ى/ي, ة/ه) and ignores phone formatting.

**Merges (D3)** move activities, follow-ups, consults, enrolments and consent records; the loser is soft-deleted
with `merged_into_id` and a snapshot is kept for a 7-day undo. Stage events stay with their lead.

**Not built in 1.1** (later releases per the blueprint): scoring (S1-S3), events, onboarding, referrals, proof
library, the extended reports (R1-R6), capture form and UTM (A1, A2, A4), daily digest and push (N2, N3),
booking page (B1), integrations (2.0). A minimal notification centre (N1) was needed for the built-in rules.

## Finance and Notion

### Camp brand replaces the blueprint's gold
The Notion *Brand Guardrails* page is Camp's source of truth: Ground #0B0B10, Card #16151D, one accent
**Indigo #5E50FF** (soft #8B7FFF), Ink #F4F3F8, Bodoni Moda for headlines and Archivo for text. It overrides
the blueprint's "one gold accent". The light theme keeps the same indigo, darkened for text so contrast stays
at 4.5:1. White on indigo buttons hovers to the deeper indigo (the lighter one would fail contrast).
"Cohort" is called **Batch** in the interface, as in Notion; the code and database keep `cohort`.

### Payments moved into a ledger
An enrolment used to hold one amount, a paid date, a reference and a gateway (Paymob). Camp has no payment
gateway (candidates pay OrlaDent directly), offers installments and free seats, and tracks money in the Notion
Ledger. So:
* `enrolments` keeps the agreed **price** (before discount), the **discount**, the **payment plan**
  (one-time, installments, free seat), installment dates, the student **status** (active, graduated, dropped)
  and notes.
* Every movement of money is a `ledger_entries` row with the same shape as the Notion Ledger (section,
  category, status, partner, from/to, notes, date, "date approximate"), plus a CRM-only **reference**.
* Migration 0004 turned every paid enrolment into one Received ledger row (with its reference and date) and
  kept an unpaid enrolment's reference in its notes. Tested in `finance.integration.test.ts`.
* Enrolling records what was paid now (Received, with its reference) and the rest as one Expected payment due
  on the final installment date. The Enrolled exit criterion is "payment received with a reference" or a free
  seat.
* Revenue on the dashboard is what students owe (price − discount), collected is what the ledger received.

### The finance board
Built from the Finances page rules (METRICS.md > Finance), inspired by the shared *Finance Board* artifact
and extended: month navigation, month-over-month deltas, partner cards with running balances and a
withdrawn bar, Capital left, 12 months of received vs costs with a table view, category breakdown, "Coming
up" with one-click settle, candidate collection, and a full ledger with search and filters. The split is a
setting (it must total 100), applied to every month: a change is a new rule, not a record, so past months
are recomputed with it (QUESTIONS 36). Only owner and finance see Finance; only they write money
(`payment:write`); only owners change the split.

### Notion as the shared backend: two-way sync
Chosen with the owners ("Two-way sync"): Postgres stays the CRM's database (transactions, fast queries,
tests, backups) and a sync keeps Notion's Batches, Candidates and Ledger in step, plus a **CRM Leads**
database it creates. Design (`src/lib/notion/`):
* No SDK: a small REST client, one request queue spaced 340 ms (Notion's ~3 requests/second), retries on 429
  and 5xx with Retry-After. The token only comes from `NOTION_TOKEN`.
* `notion_links` maps each row to its page with the hash of the field values both sides agreed on and the
  local `updated_at` at that moment. A run pulls pages edited since the last run (2 minutes of overlap:
  Notion edit times are to the minute), then pushes rows changed since. Same hash = nothing to do, which also
  ignores our own writes coming back.
* Both sides changed: the newer edit wins; counted as a conflict in the run log.
* Some values are the CRM's (lead stage, owner, batch counts, a normalised phone): after a pull, anything that
  differs is written back, so Notion shows the CRM's truth.
* First run: rows that already exist on both sides are matched, not duplicated.
* Deletion: a ledger page archived in Notion soft-deletes the entry; a row deleted in the CRM archives its
  page; other pages deleted in Notion are unlinked and reported (a batch or a student is never deleted from
  Notion's side). Nothing is hard-deleted.
* At most 250 writes per run, so a first sync of thousands of leads spreads over several minutes without
  hitting the rate limit. Runs never overlap (single flight; "Sync now" joins a running sync).
* Tested against an in-memory Notion with the API's shapes (`tests/fake-notion.ts`,
  `notion-sync.integration.test.ts`): first push with relations, idle run makes no writes, both directions,
  Notion-created candidates and ledger rows, deletions both ways, invalid pages, read-only stage, conflicts,
  retry on 429. It has not been run against the live workspace from here (no token in this environment): do
  the first sync with **Sync now** and check the run log.

### Audit (this release)
Reviewed every new server action, route and page for role checks, input validation and data exposure, plus
the existing CRM for the same classes of problem. Fixed:
* `back` fields accepted `/\host`, which browsers treat as another site: now `safePath()` (tested).
* "1.5" EGP was read as 15: amounts must be whole numbers; "1,500" and "1 500 EGP" still work.
* An installment without a due date showed as overdue.
* Deleting a payment or ledger row took one click: it now asks first.
* Owner changes by workflow rules did not bump `updated_at`, so they would not have synced.
* A Notion ledger row linked to a candidate the CRM had not linked yet would have dropped the link: it now
  waits.
* The enrol, entry and quick-add dialogs could not scroll on short screens (the Enrol button was unreachable
  on a laptop): they scroll now.
* Primary buttons failed contrast on hover.

## Programme data from Notion (consent, QC, sessions, proof, team)

The owners asked for every Notion-only column to come into the CRM:
* **Candidates**: *Consent on file?*, *Consent scope*, *QC score* and *Leaderboard rank* are columns on
  `enrolments` and sync both ways. The consent here is **content consent** (may we use their work and words),
  kept apart from the WhatsApp contact permission, which is a different agreement.
* **Sessions** and the **Proof & Testimonial Bank** are tables of their own (`programme_sessions`,
  `proof_items`) linked to the enrolment, synced both ways like the ledger (deleted on one side, deleted on
  the other; soft deletes only). Option lists are Notion's labels, stored as they are, so values round-trip.
  The quote text is never written to the audit log.
* **Team** (`team_members`: name, role, group, status, contact, duties) syncs both ways, so a cost can say
  who it was paid to (the Ledger's *Team member*) and owners can add people in Settings > Team. Salary,
  equity, payment schedule and compensation notes are never copied: a Notion page update only changes the
  properties it sends, so those columns keep whatever Notion has. There is no delete: Inactive keeps past
  costs pointing at the person. (Sync version 3 re-reads Team for the new Duties column.)
* Adding fields to a synced table would make the next push overwrite Notion's values with the CRM's empty
  defaults. The sync therefore carries a version: when it rises, the next run reads every page before
  writing anything (tested: a value set in Notion long ago survives the upgrade).
* A proof item is **Ready** only when its consent is Granted and the candidate's content consent is not
  refused; the Proof bank shows the rest as waiting, per the "no income promises, real quotes only" guardrails.
* `NOTION_SYNC_LEADS=true` is now written in `.env.example` (the owners' decision, QUESTIONS 39).

Found and fixed on the way: the enrol dialog's "seats taken" count on the pipeline and lead pages compared
the wrong ids (a Drizzle subquery lost its table name), so a full batch could look open until the server
refused the enrolment. Both now name the table explicitly.

## Notion as the place leads are fed

* The **Leads** database was created in the camp's Notion (under OrlaDent Camp) and is the default
  `NOTION_LEADS_DB`. A row typed there becomes a CRM lead through the same `createLead` as the quick-add form:
  phone normalised and validated, duplicates by phone or email linked instead of copied, routing rules pick the
  owner, the "new lead" workflow fires. Name, phone, email, source, segment, tier interest and notes sync both
  ways; stage, owner, created and decision date stay the CRM's (the pipeline's exit criteria and history
  live there) and are written back to Notion. An unreadable number is reported in the run log, not guessed.
  Sync version 4 re-reads the Leads database for the new columns.
* Demo data is **off by default** (`SEED_DEMO=false`; CI turns it on for the stack test). Owners remove demo
  rows from an existing install in Settings > Integrations: demo leads are recognised by construction
  (name "Demo Lead NN" and a +20108000000NN number), batches by name when nothing real uses them, money,
  sessions and proof by the "DEMO " prefix. Tested: nothing real is touched, and a second run is a no-op.
  Rows already mirrored to Notion keep their link, marked "gone", and their pages are archived: deleting the
  link instead would make the next read of Notion treat those pages as new rows and bring the demo back.
* A phone or email typed in Notion that another lead already has is not saved (it would break the unique
  index and stop every later lead in the run from syncing); the run log names both leads so they can be merged.

## Fonts

The owners asked for clean, readable type: **Inter** everywhere (headings included, semibold with tight
tracking), with **Noto Sans Arabic** as the fallback for Arabic names. This replaces Bodoni Moda and Archivo.

## OrlaDent OS, Phase 1 (Command centre and foundations)

The plan that turns the CRM into the brand's operating system lives in the shared doc "OrlaDent OS: roadmap from
CRM to brand mastermind". Phase 1 builds what every later module reports into.

* **Tasks are separate from follow-ups.** A follow-up is the sales cadence on one lead and drives Today, the
  response clock and the stop rules. A task is any other work, on a lead, a batch or nothing. Merging them would
  have tangled the sales metrics with team chores. Tasks move with a lead in a merge (and back on undo).
* **Targets are quarterly, on the Cairo calendar**, and progress is computed live from the same tables as the
  dashboard (never typed in). Pace compares the actual with an even spread over the quarter; "at risk" is within
  20% of that. Revenue counts what the quarter's new students owe, with dropped students counting what they
  paid (the same rule as everywhere since question 10).
* **The pulse is a rolling 7 days**, not the calendar week, so Monday and Thursday compare like with like. The
  weekly review uses Monday-to-Sunday weeks and saves that week's numbers with it, so history does not change
  when data is corrected later.
* **Alerts are computed, not stored.** Each line is a count with a link to the list behind it, using the same
  definitions as Today and the smart views. Nothing to dismiss or go stale; money lines only for owners and
  finance.
* **Tools are pure functions with unit tests** (`src/lib/tools.ts`), used directly by the browser components.
  The offer schedule rounds instalments down to 50 EGP and puts the remainder in the last one, so the sum is
  exact. The batch planner never shows a weekly figure larger than the total.
* **Two-factor sign-in** follows RFC 6238 (checked against the RFC's test vectors) using `node:crypto`, not a
  library. The secret is sealed with AES-256-GCM under a key derived from `AUTH_SECRET`; a code works once (the
  used step is recorded in the same UPDATE that accepts it, so two racing requests cannot both pass); 10 recovery
  codes are stored as SHA-256. The password step issues only a 5-minute pass scoped to `/login`; session tokens
  now carry `purpose: session` and any other purpose is refused, so the pass can never act as a session. Tokens
  signed before this change (no purpose) stay valid, so nobody was signed out. Found and closed during
  development: without the purpose check the pass would have been accepted as a session.
* **Files live in Postgres (bytea), 8 MB each.** The existing `pg_dump` backup covers them with no new service,
  and access control is the same code as the record they belong to. Only an allow-list of types is accepted;
  only raster images open inline, everything else downloads as `application/octet-stream` with `nosniff` and a
  sandbox CSP. Deleting a file removes its bytes. If files grow into videos or thousands of case files, move the
  bytes to S3-compatible storage and keep this table as the index.
* **New permissions**: `task:write` and `file:write` (owner, sales, finance), `lead:export` (owners). Every new
  action is in the role matrix test, which calls the real actions once per role.

Verified: lint, types, 350+ unit and integration tests (tasks, targets, pulse and alerts, planner defaults, the
TOTP vectors, the whole two-factor sign-in against a real database, files and their download headers, the role
matrix), and the browser suite: accessibility of every new screen in both themes, plus a Phase 1 journey
(targets, a task from creation to done, the offer builder saving on a lead, a file upload and download, and
two-factor set up and used in a real browser).

## OrlaDent OS, Phase 2 (growth and content)

* **Campaigns hold the money through the ledger.** Spend is the Paid ledger costs tagged with the campaign
  (Owed shown apart), never a number typed on the campaign, so the books and the campaign report cannot
  disagree. `saveEntry` only writes the tag when a caller passes it, so editing a cost from the ledger form or the
  Notion sync keeps its campaign. A campaign with tagged costs cannot be deleted.
* **One intake for every outside lead.** The public forms and the webhook both go through `intake()`: phone
  normalised, a known person linked (never duplicated, with a note on their timeline), new leads through
  `createLead` so routing and the new-lead rules apply, consent recorded as method *form* only when ticked.
  The public page never reveals whether someone was already a lead.
* **Public form defences** without a third-party captcha (no extra request, nothing to configure): a hidden
  honeypot field; a stamp signed with `AUTH_SECRET` that records when the page was shown (no posting without the
  page, nor within 2 seconds, nor after 6 hours); 5 sign-ups per address per 10 minutes; bots get the normal
  thank-you so they learn nothing. Addresses are stored only as a keyed hash. If spam gets through at volume,
  add a captcha then.
* **The webhook** is off until `INBOUND_LEADS_TOKEN` (24+ characters) is set, compares the token in constant
  time before reading the body, is rate limited, and keeps only known tracking keys. A guard test pins that order.
* **Attribution is stored on the lead** (`leads.attribution`: utm_source/medium/campaign/content/term, ref, form),
  cleaned to known keys and 100 characters each. A content piece's tag is its `utm_content`, which is how leads
  are counted per post without any platform integration.
* **Masterclass registrants are derived**, not copied: leads tagged to the campaign, its form sign-ups, plus
  anyone registered by hand. A row in `event_attendance` exists only once someone acts (reminded, came). Merging
  two registrants of the same event combines their rows first (came if either came). Reminders open WhatsApp
  with the text filled in and are logged as a WhatsApp sent; nothing is sent automatically.
* **Proof-to-post checks consent on the server** with the same rule as the proof bank's Ready badge.
* **Referral rewards are decisions, not formulas**: a row appears when a referred lead enrols; approving needs
  an amount typed by a person (QUESTIONS.md 29); Paid writes one ledger cost. Merges move referrals, rewards
  and the code to the survivor; a code on a merged-away lead still resolves.
* **Not built in Phase 2, by choice**: the caption and repurposing generators need the AI assistant (Phase 5);
  sending WhatsApp messages and reading Meta ads data need accounts and decisions (QUESTIONS.md 39–40).
* **Accessibility**: found and fixed by the automated checks during this phase: the calendar first used grid
  roles without rows, faint out-of-month dates and a sideways-scrolling area unreachable by keyboard; it is now
  a list of days with full dates for screen readers, inside a focusable region.

Verified: lint, types, unit and integration tests for every module (including the public form's defences
through the real action, the webhook through the real route, merges of registrants and referrers, the cost tag
surviving a ledger edit), the role matrix for every new action, and the browser suite: every new screen in both
themes plus a masterclass run end to end (campaign, form, a signed-out visitor signing up from a tracked link,
attendance) and content and referrals.

## OrlaDent OS, Phase 3 (student success)

* **An instructor role**, not a flag on sales: read leads, add tasks and files, and `programme:write` (classes,
  attendance, assignments and reviews, graduation, alumni, portal invites). No money (`finance:read`), no lead
  editing, no settings. Owners hold `programme:write` too; graduating someone who misses the rules, and revoking
  a certificate, stay with owners.
* **Attendance rate = (present + late) ÷ (present + late + absent).** Excused classes do not count against
  anyone, and a class nobody marked counts for no one, so a batch with no attendance taken has no attendance
  rule to meet (said on the graduation page) rather than everyone at 0%.
* **Missed classes make one task, not a stream.** At the second unexcused absence in a batch
  (`MISSED_FOR_CHECK_IN`) a high-priority check-in task is created once per student and batch, for the person
  who marked it. Nothing is sent to the student.
* **Rubrics are plain text** (`name | points`, 1 to 10 criteria) stored as JSON on the assignment, so instructors
  write them without a form builder. A review stores each criterion's score with its name and maximum, so later
  rubric edits do not rewrite past results. A resubmission is a new attempt on the same row: scores cleared,
  feedback kept until the next review, `attempt` counted.
* **QC score and leaderboard come from reviews when a batch uses them**: QC = the rounded average of the
  student's reviewed results; rank = SQL `rank()` by QC in the batch (ties share a rank: 1, 1, 3), dropped
  students left out. Only rows with a reviewed result are touched, so a QC or rank typed by hand or synced from
  Notion for a batch without reviews is left alone.
* **Certificates are snapshots.** The name, programme, batch and date are copied onto the certificate when it is
  issued, so renaming a lead or a batch later never changes a certificate already handed out. Codes are
  `OC-XXXX-XXXX` from a 31-character alphabet without look-alikes (0/O, 1/I/L), from `crypto.randomBytes`. One
  certificate per enrolment; graduating again after a revoke reissues it with a new code. The public check page
  shows only what is printed on the certificate.
* **Graduating someone who misses the rules needs an owner and a reason**, kept on the certificate and in the
  audit log. Graduation also opens the alumni profile and the referral code, so a graduate can refer at once.
* **The student portal has its own session**, never the staff one: cookie `orla_student`, path `/portal`, 14
  days, signed with purpose `student`. Staff tokens carry purpose `session`; each verifier rejects the other's
  (and the 2FA pending token), and the guard tests pin that portal code never touches the staff cookie or
  staff checks and vice versa. Middleware lets `/portal*` through; every portal page and action calls
  `requireStudent()`, which rechecks the account in the database on every request (switched off, or the
  password changed since sign-in, means signed out).
* **Invites store only a hash** of a 32-byte random token, expire in 7 days, are single-use and are only for an
  enrolled student with a WhatsApp number. The link is shown to staff once. Sign-in is by the WhatsApp number in
  any format (normalised like leads) and password, rate limited like staff sign-in.
* **What a student acts on comes from their session, never the form**: work is sent only for an assignment of
  their own batch (the enrolment is looked up from the signed-in student), and portal pages read only their own
  lead's records. Money in the portal is their own plan and payments only.
* **Merges and demo cleanup** move or remove every new table (attendance, submissions, certificates via
  enrolments; alumni profiles and portal accounts, dropping the loser's duplicate).

Verified: lint, types, unit and integration tests for classes (attendance, check-ins, copy), assignments
(rubric parsing, reviews, attempts, QC and ranks with ties), graduation (rules, override, revoke, public check),
the portal (invite, sign-in, rate limit, session separation, own-batch only), the role matrix with the instructor
role, and the browser suite: every new screen in both themes plus a term end to end (class and attendance, an
assignment reviewed, graduation, the certificate checked signed out, and the student's portal).

## OrlaDent OS, Phase 4 (production studio, team and money)

* **Production work is a separate world from leads.** Clients (clinics and labs) are their own records, not
  leads: a clinic is a business with terms and invoices, not a person in a sales funnel. Designers are staff
  users with the new **designer** role, so a Production Partner graduate can be given an account without seeing
  the lead list, students or prices.
* **The designer role made every staff page state its permission.** Until now every role could read leads, so
  pages only checked the sign-in. Every page under the app now calls `requirePageCan(...)`, a guard test fails
  the build for a page that does not, Today sends people without the lead list to the studio, and the sidebar
  shows designers only the studio. A case's files open for whoever may see the case (a designer only their own);
  anyone else gets "not found", not "forbidden".
* **Price and pay are fixed at intake**: price = units × unit price, plus the rush surcharge, less the client's
  discount, in whole EGP at each step; designer pay = units × pay per unit. Later price-list changes never
  rewrite a case. Turnaround is counted in working days with Fridays off, due 18:00 Cairo time; one pure
  function (`quote`) serves both intake and the quote tool, so they cannot disagree.
* **QC is a checklist, checked by someone else.** The designer cannot pass their own case. Everything ticked
  passes; anything unticked needs a note and sends the case back (`qc_fails` + 1). The first-time pass rate is
  delivered cases with no fails ÷ delivered cases. Files can be changed only while assigned or designing, so
  what QC saw is what is delivered.
* **Money stays in the ledger.** Delivery books the designer's pay as an Owed cost (Production designers,
  linked to the case). An invoice is a document (number, lines and total as issued); what is owed is one
  Expected "OrlaDent client work" row, settled by full or part payments into Received rows. So the Finance
  board, the coming-up list, the forecast and client balances needed no new money logic. Invoices are numbered
  per Cairo year (INV-2026-0001) inside a transaction that locks the cases; a clash on the number retries.
  Voiding is only possible before any payment; numbers are never reused.
* **Receipts come from any received income row** (students' payments too), numbered by the ledger row. Invoice
  and receipt pages sit outside the app shell (they print as they show) and check the user themselves; a guard
  test pins that. The business details on them are a setting, because only the name is known.
* **Playbooks are copied into each checklist** when it starts, so editing a playbook never changes a checklist
  under way. A checklist completes itself when every step is ticked and reopens if one is unticked.
* **Decisions** are closed by their owner or an owner of the business, with an outcome. Overdue open decisions,
  overdue checklists and jobs nobody does are alerts.
* **Budgets are per month and cost category**; a zero removes the line. Actual = Paid + Owed rows dated in the
  month, so a bill booked but not yet paid already uses the budget.
* **The cash forecast never assumes late money.** Expected or owed rows already past their date are shown apart.
  Unbooked budget (budget − paid − owed, if positive) is spread evenly over the month's remaining days. There is
  no bank balance in the app, so the running balance starts from a number the person types.
* **Unit economics**: a batch's revenue uses the same rule as everywhere (what students owe; dropped students
  what they kept paid); its costs are ledger costs tagged to the batch, so the ledger form now lets a cost be
  tagged to a batch (and editing a cost no longer drops the batch the Notion sync gave it). Marketing spend =
  paid costs in Ads & promotion or Referral rewards, or tagged to a campaign.
* **Not built in Phase 4, by choice**: a payment gateway (needs the owners' choice of Paymob, Fawry or another,
  and an account), clients signing in (no ask yet), and designer pay runs (pay stays an Owed row per case,
  settled from the ledger).
* **Found while building**: in the select list of a query without a join, drizzle leaves column names
  unqualified, so `${table.id}` inside a correlated subquery meant the subquery's own `id`. The new client list
  had it (wrong counts, then an error) and was fixed by writing the table name out; the existing code was
  checked and only uses it in joined queries or WHERE clauses, where drizzle qualifies it.

Verified: lint, types, unit and integration tests for the studio (prices and turnaround, the whole case flow,
who sees what, the pulse and designer figures), invoicing (numbering, part payments, void, balances, the books),
team and operations, budgets, the forecast and unit economics; the role matrix with the designer role and every
new action; guard tests for staff pages and print pages; and the browser suite: a case from price list to
receipt with a designer who sees only her case, plus every new screen in both themes.

## OrlaDent OS, Phase 5 (the AI assistant)

* **Off by default, and two locks.** The assistant runs only when an owner switches it on in Settings and the
  server has `ANTHROPIC_API_KEY`. Pages show the AI buttons only when both hold and the person may use it
  (`ai:use`: everyone but designers). Each person has a daily request limit.
* **One way to call Claude** (`src/lib/ai/core.ts`): the official SDK, model Claude Opus 5.5 (`AI_MODEL`
  overrides it), with server-side fallback if the model declines, effort set per feature, and the stable
  instructions cached (`cache_control`) with the per-request facts after them. Refusals, rate limits, a bad key
  and network failures become messages a person can act on. Only token counts are stored (`ai_usage`), never
  content; Ask OrlaDent keeps each person's own conversations (`ai_threads`, `ai_messages`), visible only to them.
* **Ask OrlaDent reads through tools, never SQL.** Claude gets a short list of read-only lookups built on the
  app's own functions (metrics, alerts, batches, campaigns, leads, a lead's history, students, the books,
  production). A tool is offered only if the owners allow that kind of data AND the person's role may see it;
  a tool the person may not use is refused even if Claude asks for it. Money fields are dropped for people who
  cannot see money. At most 6 lookups per question.
* **Contact details never leave.** `redact()` removes emails and phone numbers (8+ digits; dates and grouped
  amounts kept) from notes and messages before they are sent, and the tools never return the phone or email
  columns. A test caught dates being masked as phone numbers; they are now kept.
* **Answers link only inside the app.** The answer is rendered by a small markdown renderer that never renders
  HTML and turns only paths starting with a single "/" into links.
* **Drafts are never sent.** WhatsApp drafts go into the existing composer (edit → Open in WhatsApp → "I sent
  it"); captions, scripts and briefs are text to copy; the weekly review is put into the form for an owner to
  save. Every draft prompt forbids inventing prices, dates, discounts, results or promises and asks for
  [placeholders] instead; drafts follow the owners' brand voice from Settings. A student's quote is used only
  when its consent is Granted, word for word.
* **Early warning needs no AI.** The drop-risk score is plain rules with a reason for every point, so it works
  with the assistant off and can be checked by hand; Ask OrlaDent's student lookup includes it.
* **Testing without a key.** Tests replace Claude with scripted fakes (`setAiForTests`); the browser suite uses
  a deterministic fake that is honoured only when `AI_FAKE=e2e` and the database is a `crm_e2e*` scratch one.
* **Not built, by choice**: streaming answers (a question takes seconds; the page shows progress), Claude
  writing to the app (it only reads), and sending drafts automatically.

Verified: lint, types, unit and integration tests for the core (switch, limit, usage, refusal and errors,
redaction), Ask OrlaDent (tool gating by role and settings, the loop, saving, privacy of conversations),
every draft (permissions, do-not-contact, consent, the facts given), the drop-risk score and its alert; the
role matrix with every new action; and the browser suite: switching it on, a question answered with a link,
a WhatsApp draft, and the new screens in both themes.
