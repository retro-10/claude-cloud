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
The seed creates Retro (owner), Badr (owner) and Murail (viewer) with emails `@orladent.local` and one shared password from `SEED_PASSWORD`. Badr has "final say", so he is an owner. Replace emails and passwords before real use (see `QUESTIONS.md`).
