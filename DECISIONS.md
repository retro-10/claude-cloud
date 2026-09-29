# Decisions

## Stack
- **Next.js 14 (App Router) + TypeScript + Tailwind 3.** One deployable, server actions for writes, no separate API layer to maintain. Next 14 and Tailwind 3 chosen over the newest majors for stability.
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
Inter and Playfair Display load from Google Fonts in the browser. The app runs without them (falls back to system fonts), so nothing needs the network to start. To self-host later, drop the font files in `public/` and replace the `@import` in `globals.css`.

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
