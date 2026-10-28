# HQ v2: review of the design brief, and the plan to build and ship it

28 Oct 2026. Input: "HQ: Product Design Reference" (research brief). Checked against `main` at `5ed193d`, the live Notion
workspace, and current Supabase docs and changelog.

## 1. Verdict on the brief

**Keep:**
- The product shape: one shell, a shared spine, modules.
- The design principles: search first, one inbox, the same list pattern everywhere, next step mandatory, audit by default.
- The access rules: no self-approval, server checks rather than hidden menus.
- The employee portal design.

**Change:**
- Scope: about half of the module screens are enterprise features that a team of roughly 10 people won't use (section 4).
- The build order: most of the brief's steps 1, 3 and 5 already exist.

**Add:**
- Retiring Notion.
- Email.
- Backups.
- Deployment.

The brief covers none of these four (section 3).

### 1.1 Claims about the repo, checked

| Brief says | Repo actually | Status |
|---|---|---|
| Six staff roles enforced on the server plus the student portal | `src/lib/rbac.ts`: owner, sales, viewer, finance, instructor, designer; the portal has its own session | Correct |
| Access map rows (section 11) | Matches `rbac.ts` row by row: viewers have AI, designers have chat and calendar, finance has growth costs only, owners create spaces (`ops:manage`) | Correct |
| ⌘K palette exists | It exists, but `/api/search` only finds **leads**; pages are a static list | Partial: records, people, docs, tasks and actions are a real gap |
| Inbox exists | It does, but it only shows notifications; nothing can be acted on in place | Partial |
| Approvals missing | Two single-purpose approvals exist: partner pay review (`approvePay`) and production QC. There is no general engine | Mostly correct |
| Quote builder | `/tools/offer` builds an offer, with no approval, send or accept | Partial |
| Invoices "from won deals" | Invoices exist for production cases only; camp enrolments are payments on the ledger | Gap, and it may not be needed (section 4) |
| Directory | `/team` lists Notion Team members; it is not tied to user accounts | Partial |
| Knowledge base | Docs and the SOP library exist; SOPs have no review date | Partial |
| Announcements, polls, recognition, onboarding, expenses | Not present | Correct |
| Arabic / RTL | `lang="en"`; user text uses `dir="auto"`; there are no translations | Correct: not built |
| Contract storage can reuse the file store (8 MB, DB or Drive) | `attachments`, 8 MB, DB or Drive as of PR #6 | Correct |
| "Do not extend `team_members`: it syncs to Notion" | True today. Once Notion is retired that reason goes away, but separate tables are still right: pay and contracts need stricter access than the team list | Reason expires; the advice stands |

### 1.2 Sources

The patterns hold up because many independent products share them. Some citations are weak, though.

**Spot-checked:**
- The Numera finance case study (markusvisuals.netlify.app) now returns a **404**.
- The "Pipedrive review" (rankforge-sites.pages.dev) is an **affiliate** page; it carries an Impact verification tag.
- The RTL checklist is an agency blog post. The advice is sound but it is marketing material.

**Not checked:** the other portfolio and `.pages.dev` sources (Shilly, Seampoint, elhussainy).

No decision below rests only on a weak source. The brief's own caveat ("much of this is vendor material") is accurate.

### 1.3 What the brief leaves out

1. **Notion still holds data the app does not.** Only seven databases sync. These do not:
   - the **Assets** database;
   - **Brand Guardrails** and **Reel & Script Guidelines** (these are the brand hub);
   - the **Content Calendar** and **Production Sprint** databases;
   - a **Finances** page;
   - the Team database's **pay, equity and compensation notes**, which the sync deliberately never reads.

   Retiring Notion means each of these needs a home in HQ first.
2. **Email.** The app cannot send email; there is no SMTP or provider. Approvals, must-read reminders, invoice reminders and "you were mentioned" when away all need it.
3. **Backups on Supabase.** The free plan has **no automatic backups**. Pro has 7 days of daily backups, and point-in-time restore is a paid add-on. The repo's `scripts/backup.sh` is written for Docker.
4. **Deployment.** Two things are unresolved:
   - Render: no payment card yet, and the free plan sleeps (timed jobs pause while it sleeps).
   - Domain: `hq.orladent.com` has no DNS record yet.
5. **Who the users are.** About 10 staff and per-case designers. Brief features sized for 500-person companies (DAM usage rights, annotated proofing, sequences, delegation and escalation SLAs) cost more than they return.

## 2. Target architecture

| Part | Today | Target |
|---|---|---|
| App | Docker on a laptop | **Render** web service (Docker, Frankfurt), auto-deploy from `main` |
| Database | Docker Postgres | **Supabase** Postgres 17 (Ireland), **session pooler port 5432**. Supabase recommends this for a long-running server on IPv4; Render has no IPv6, so the direct connection is not an option |
| Data API | n/a | Not used. Every table gets RLS on each start (done in PR #6). Supabase stops exposing new tables by default on 30 Oct 2026 |
| Source of truth | Two-way Notion sync | **HQ only.** Notion is imported once, then the sync is switched off and removed |
| Files | Postgres `bytea` | **Google Drive** (built in PR #6); the database is the fallback |
| Timed jobs | `setInterval` in the server | Same, which needs an always-on instance. Optionally add a Render Cron Job hitting `/api/cron` as a backstop |
| Backups | `scripts/backup.sh` (Docker) | Nightly `pg_dump` using `BACKUP_MODE=direct`, from a Render Cron Job or GitHub Actions, to a private Drive folder; plus Supabase Pro daily backups |
| Chat | Polling every 3 seconds | Keep. Supabase Realtime would need supabase-js and Supabase-issued tokens, while the app has its own login. Not worth it at this size |

## 3. MCPs and APIs

### 3.1 For Claude (to build, migrate and deploy)

| MCP | State | Needed for | Action |
|---|---|---|---|
| GitHub | Working | PRs, CI | None |
| Notion | Working | Reading every database and page for the one-time import | None |
| Supabase | **Fails in cloud sessions** (proxy tunnel error) | Checking the schema, running Supabase's security and performance checks, confirming the migration | Run those steps from Claude Code on your Mac, or retry in a new cloud session |
| Render | Connected, **blocked: no payment card** | Creating the service, env vars, deploy logs | You add a card at dashboard.render.com/billing |
| Hostinger | Connected | DNS: CNAME `hq` → Render | None |
| Google Drive | Connected | Checking the files folder, putting backups there | None |

### 3.2 For the app (environment variables on Render)

| API | Status | Used for | You provide |
|---|---|---|---|
| Supabase Postgres | Ready | Everything | `DATABASE_URL`, session pooler, **with a new password** (the current one was pasted in chat) |
| Google Drive API (OAuth) | Built | Files, contracts, backups | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`; consent screen **published** |
| Anthropic API | Built | Ask OrlaDent and drafts | `ANTHROPIC_API_KEY` (optional) |
| Notion API | Built; **removed after import** | One-time import | `NOTION_TOKEN` during the cutover only |
| **Email (new)** | Not built | Approvals, reminders, must-read items, password reset | Resend (free tier, 3,000 emails a month) with an `orladent.com` sender: `RESEND_API_KEY` and 3 DNS records at Hostinger, which I can add |
| Payment link (optional, later) | Not built | "Pay now" on invoices | Paymob or Fawry merchant account. Only if you want online payment |
| E-signature (optional) | Not built | Legally binding contracts | Only if a lawyer says the tick-to-acknowledge record is not enough |

## 4. Scope: what to build, what to defer, what to skip

**Build now (v2):**

| Area | What | Why |
|---|---|---|
| Spine | **Approvals engine**: request types (expense, purchase, leave, discount, brand request), routing by type and amount, approver queue in the Inbox sorted by waiting time, no self-approval, immutable log | Every cross-module flow in the brief depends on it |
| Spine | **Inbox actions**: approve, reject or ask for info inline; must-read items | The "one inbox" principle |
| Spine | **⌘K over records**: leads, people, tasks, docs, batches, cases, campaigns, chat channels, plus actions. Permission-filtered, opens on recents | Highest-leverage UX gap |
| Spine | **Email notifications** (Resend), per-person notification settings | Approvals and reminders need it |
| Comms | **Announcements**: targeted by role or team, pinned, must-acknowledge with tracking and reminders. **Directory** tied to user accounts | Gets everyone in daily |
| Branding | **Brand hub**: guidelines as Docs (imported from Notion), **asset library** (imported Assets DB) with tags, versions, "retired" status and a download log | The Notion content already exists |
| Finance | **Expenses** (receipt, category, campaign tag) through approvals into the ledger; **budget vs actual** per campaign | Spend request flow |
| People | **Employee portal** (brief section 13): `employees`, `employee_documents` with versions and acknowledgement, `employee:self` / `employee:manage`, 2FA required for that area; pay and equity imported from Notion Team | Notion pay data needs a home anyway |
| Roles | **Marketing** role | In the brief's access map |
| Ops | Notion import and switch-off, backups, Render deploy, domain, monitoring | Go-live |

**Defer (v2.1+):** quote approval, send and accept; leave balances; polls; recognition; onboarding auto-tasks; invoices from won enrolments; platform-accurate post previews; sequences.

**Skip unless asked:** DAM usage rights and expiry, annotated proofing, agency portals, delegation and escalation SLAs, native mobile app. Responsive web covers approvals, expenses and announcements on a phone.

**Needs your decision first** (section 9): Arabic/RTL, finance depth, identity documents, retention.

## 5. Build phases

Each phase is one PR with tests (unit, integration, e2e with accessibility scans in both themes) and green CI before merge.

| # | Phase | Contents | Done when |
|---|---|---|---|
| 0 | **Go-live of what exists** | Render service (Starter, Frankfurt), Supabase with a new password, Drive connected, `hq.orladent.com` CNAME, nightly backup job, health monitoring | Team signs in at hq.orladent.com; a backup restore drill passes |
| 1 | **Notion import, then retire** | One-off importer for the unsynced databases and pages (Assets, Content Calendar, Production Sprint, Brand Guardrails, Reel & Script Guidelines, Finances) and Team pay and equity. Final full sync of the 7 synced databases; freeze Notion (read-only); remove the sync code and `NOTION_*` variables | Row counts match Notion; owners sign off a checklist; Notion untouched for 2 weeks |
| 2 | **Spine** | Approvals engine; inbox actions; ⌘K over records and actions; email via Resend; notification settings; Marketing role | An expense goes from submit to approve to the ledger with email; ⌘K finds a doc by typo |
| 3 | **Comms + Brand hub** | Announcements with acknowledgement and reminders; directory; brand hub docs; asset library with versions, retired status and download log; brand request through approvals | A must-read reaches a role; non-readers get reminded; a retired asset disappears from the library |
| 4 | **Finance + Marketing** | Expenses; budget vs actual per campaign; campaign ↔ content ↔ budget links; finance overview header (pending approvals, uncategorised) | Campaign spend shows against budget |
| 5 | **Employee portal** | Profile, terms, documents (versions, acknowledgement), my requests, my pay (scoped); 2FA required; excluded from AI and exports | The access table in brief section 13 is enforced by tests |
| 6 | **Hardening and v2 release** | Load check, Supabase security and performance checks, accessibility pass, user guide, restore drill, owner acceptance | Release tagged |

## 6. Notion → Supabase migration runbook (phase 1)

1. **Inventory.** Fetch each Notion database's schema and row count with the Notion MCP. Map every property to an HQ column or flag it "not imported".
2. **Dry run on a scratch Supabase branch** (or a local Postgres):
   - import;
   - compare counts and spot-check 10 rows per database;
   - check pay and equity land only in `employees`, behind `employee:manage`.
3. **Cutover:**
   - announce a freeze;
   - run the importer against production;
   - run a final two-way sync;
   - set Notion pages to read-only;
   - turn the sync off (`NOTION_TOKEN` removed).
4. **Verify.** Owners tick a checklist per database. Keep the Notion workspace read-only for two weeks as a fallback.
5. **Remove the sync code.** Delete `src/lib/notion/`, its settings card and `notion_links`, in a separate PR once sign-off is done.

## 7. Deployment runbook (phase 0)

1. **You:**
   - add a card on Render;
   - reset the Supabase database password;
   - in Google Cloud, create the OAuth client and publish the consent screen, with the redirect URI `https://hq.orladent.com/settings/integrations/drive/callback`.
2. **Me (Render MCP).** Create the service `orladent-hq` (Docker, `main`, Frankfurt, Starter). Set:
   - `DATABASE_URL`, `DATABASE_POOL_MAX=5`, `AUTH_SECRET`, `SEED_PASSWORD`, `COOKIE_SECURE=true`;
   - `APP_URL=https://hq.orladent.com`;
   - the Google, Anthropic and Resend keys.
3. **Me:**
   - watch the build and start logs;
   - confirm the tables exist, have RLS on and pass Supabase's security checks (from the Mac session if the Supabase MCP still fails here).
4. **Domain.**
   - You: add the custom domain in Render (Settings → Custom Domains).
   - Me: add the CNAME `hq` → `orladent-hq.onrender.com` at Hostinger. Wait for the certificate.
5. **Backups.** A nightly job runs `pg_dump` to a private Drive folder with 14 days kept, and a monthly restore drill. Or Supabase Pro.
6. **First sign-in.**
   - Owners change the seeded passwords and turn on 2FA.
   - Remove demo data.
   - Connect Drive.
   - Add real users.

## 8. Monthly cost

| Item | Minimum | Recommended |
|---|---|---|
| Render | Free (sleeps; timed jobs pause) | Starter, about $7, always on |
| Supabase | Free (no backups; we run our own) | Pro, $25, daily backups for 7 days |
| Google Drive / Resend / Notion API | $0 | $0 |
| Anthropic | Pay per use | Capped daily per person in Settings |
| **Total** | **≈ $0** | **≈ $32** |

## 9. Decisions needed from you

1. **Hosting tier:** the minimum ($0, with sleep and no managed backups) or recommended (about $32 a month)?
2. **Arabic:** English only for v2, or Arabic/English with RTL? RTL is far cheaper to do now than to retrofit.
3. **Finance depth:** operational view (ledger, expenses, budgets), or full bookkeeping? I recommend operational, with an accountant's tool for the books.
4. **Who sees deal values, salaries and partner payouts** beyond owners and finance?
5. **Employee portal:**
   - store ID copies or only record that they were checked;
   - retention after someone leaves;
   - whether leavers can read their own documents;
   - full or reduced portal for per-case designers.
6. **Contract signing:** is a timestamped acknowledgement enough, or do you need a lawyer to confirm or a signature provider? This was not checked against Egyptian law.
7. **Email sender:** OK to send from `hq@orladent.com` via Resend, with DNS records added at Hostinger?
8. **Notion:** after the import, keep it read-only as an archive, or close it?
