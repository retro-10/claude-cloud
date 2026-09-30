# User guide

For everyone using the CRM. The goal: **reply fast, give every open lead a dated next step, move a deal only
when the buyer moved, and log everything** so the numbers are true.

## Finding your way

* **Sidebar** (left; on a phone, **More** at the bottom): Today, Leads, Pipeline, Cohorts, Dashboard, then
  **Views** with live counts (see below), then Settings for owners.
* **Ctrl K** (⌘K on a Mac), or the search box at the top of the sidebar, opens the **command palette**: type part
  of a name or a phone number in any format (`0100 777 66`, `+20 100…`, Arabic spelling variants are matched) to
  jump to a lead, or type a command ("new lead", "pipeline", "dark theme", "sign out").
* **Keyboard**: `n` new lead · `/` search on the page · `g` then `t` / `l` / `p` / `c` / `d` / `s` goes to Today,
  Leads, Pipeline, Cohorts, Dashboard, Settings · `?` shows every shortcut · `Esc` closes a dialog.
* The **bell** (top right) holds notifications from the workflow rules: a new lead arrived, a follow-up is 24
  hours overdue, nobody has answered an unassigned lead.
* Sun/moon icon: light or dark theme (remembered per browser).

## The daily routine

1. **Open Today.** The four tiles at the top say how much is waiting; click one to jump to it.
2. **Clear the Response queue first.** Everyone waiting on us: new leads nobody has answered, and leads who
   replied and are waiting for our answer. Longest waiting is on top, with a live timer: green under 5 minutes,
   amber from 5, red from 30 (Settings can change these, and can stop the clock outside working hours).
   Press **Reply** to write the message (below), or **Replied** if you already answered in WhatsApp.
3. **Overdue, then due today.** For each follow-up: message them, then **Done**. Done always asks for the next
   step (tomorrow, in 3 days, in a week, or a date), so the lead is never left without one. The clock icon moves
   a follow-up to another day.
4. **Consults today**: shows whether the lead confirmed the time; after the call record the result.
5. **Decisions due**: offers whose agreed decision date has come. Nudge them, or mark them lost.
6. **No next step**: open leads with nothing scheduled. Give each one a date (**Set next step**). Aim for an empty
   list at the end of the day.

**Only mine** (top right of Today) shows just your own leads.

## Writing a message (templates)

The **WhatsApp / Reply** buttons open the message composer:

1. Pick Arabic or English, then a template (first reply, masterclass invite, consult reminder, post-consult
   recap, decision check-in, close date) or **Blank message**.
2. The placeholders are filled from the lead and the cohort: `{first_name}`, `{tier}`, `{payment_link}`,
   `{decision_date}`, `{consult_time}`, `{cohort_name}`, `{cohort_close_date}`, `{masterclass_date}`. If a value
   is missing (say, no payment link saved yet) it is shown in yellow and sending is blocked until you fix the
   record or edit the text. Nothing is ever sent as blank text.
3. **Open in WhatsApp** opens the chat with the text already typed. You press send in WhatsApp; the CRM never
   sends anything itself.
4. Back in the CRM, **Yes, log it as sent** puts the message on the timeline (and counts as first contact).

Leads marked **do not contact** show a red badge instead of the WhatsApp button.

## Adding a lead

Press **n** (or **New lead**), type the name and WhatsApp number, pick the source, press Add. Numbers can be
written any way (`010…`, `+20 10…`, `0020…`, Arabic digits) and are stored as `+2010…`; what you typed is kept
too. A number that can't be Egyptian (for example `013…`, or too few digits) is refused with a hint.

Duplicates: the **same phone or email** is refused, with a link to the existing lead. The **same name in the same
city** with different contact details only warns (Arabic spelling variants count as the same name); you decide.
A name alone never warns. A rule creates a **"Reply within 5 minutes"** task and notifies the owner.

## A lead's page

* **Header**: stage, days in stage, the live waiting timer, health flags (neglected, stale, no next step),
  tags, contact details, owner.
* **Stage bar**: the pipeline as steps. Click a stage to move there. Moves are **earned**: each stage has
  checks that must be true first (below). Lost needs a reason; Nurture needs a next contact date; Enrolled asks
  for the batch, tier, price, payment plan, discount, what was **paid now** and its **transfer or receipt
  reference** (or a free seat).
* **Ready for …?**: before you even try, the checklist for the next stage shows what is done and what is missing.
* **Next steps**: open follow-ups (Done with next step, move, cancel), add one, or start a cadence (a scripted
  sequence that stops by itself when the lead replies or is won or lost).
* **Activity**: log calls, messages and notes; the timeline shows everything, their replies highlighted in indigo.
* **Offer**: tier, price, payment link, "link sent" and the **decision date** they agreed. These are what the
  Offer sent stage checks, and the decision date creates the decision-day follow-up.
* **Consults**: book (tick "The lead confirmed" when they confirm), then **Record result**: held or no-show, the
  outcome, the tier you recommended, the objections raised.
* **Payments** (enrolled leads): due after discount, paid, remaining; every payment and expected installment,
  with **Received** to mark one as arrived; record a payment or schedule an installment; change the plan,
  price, discount or student status (Active, Graduated, Dropped).
* **Programme** (enrolled leads): QC score, leaderboard rank, **content consent** (whether we may use their
  work and words in content, and for what: voice, video, patient case, name), their **sessions** (1:1s and
  group Q&As, with the recording link) and **proof & testimonials** (type, consent status, where it may be
  used, the real quote word for word). All of it is the same data as in Notion. Content consent is separate
  from contact permission below.
* **Contact permission**: record how they agreed to WhatsApp contact (they messaged first, form, in chat, on a
  call) or that they refused; **Mark do not contact** hides every send action.
* **Tags**, **Merge with a duplicate…**, **Undo merge** (7 days), **Delete** (restorable).

## What each stage needs (exit criteria)

| Moving into | Must be true |
| --- | --- |
| Contacted | first outbound message logged |
| Replied | their reply logged |
| Consult booked | consult booked and confirmed by the lead |
| Consult held | consult marked held, objections and tier recommendation recorded |
| Offer sent | tier chosen, price stated, payment link sent, decision date agreed |
| Enrolled | payment confirmed with a reference |
| Lost | lost reason chosen |
| Nurture | next contact date set |

If something is missing, the move is refused with the list and what to do about each item. **Owners** can move
anyway by writing why; that goes to the audit log. Booking or holding a consult moves the lead forward
automatically only once the checks pass. Settings > Stages & criteria changes the checks.

## Views (sidebar)

| View | Shows |
| --- | --- |
| Uncontacted | open leads nobody has messaged yet |
| No next step | open or nurture leads with no open follow-up |
| Neglected | open leads with no logged activity for 14 days (a far-off follow-up does not hide them) |
| Stale | open leads that have not changed stage for 30 days |
| Decision due | offers whose decision date is today or past, or 3+ days old with no date |
| Consults this week | a consult in the next 7 days |
| No-decision review | lost as "No decision" (went silent after the offer), not reviewed yet: **Reactivate** (back to Nurture with a follow-up in 7 days) or **Close** |
| Nurture review | lost on price or timing: worth a later check-in |

Thresholds are in Settings > Thresholds & routing. Saved views of your own filters appear next to them.

## Pipeline (board)

Columns are the stages, with the number of leads and the value of offers in each. Cards show the owner, tier,
days in stage, flags, the offered price and decision date, and the next follow-up (red border = overdue). **Drag**
a card, or use **Move to…**. **Needs attention** shows only flagged cards; the box filters by name.

## Leads list

Search (name, phone in any format, email, city, notes). **Filters** opens stage, source, segment, tier, owner, tag,
dates and "overdue follow-up". **Save view** keeps a filter (optionally shared). Tick leads to move stage, assign
or start a cadence in bulk (exit criteria apply per lead; skipped leads are reported). **Import** and **Export
CSV** work as before; imports of past data are not checked against exit criteria and do not fire rules.

## Merging duplicates

From a lead: **Merge with a duplicate…** suggests likely matches (same name, same email, same last 8 digits of
the phone) or search for the other record. The side-by-side view lets you pick, field by field, which value to
keep. The lead further along the pipeline keeps its record and stage; every activity, follow-up, consult,
payment and consent record of the other moves over, so the combined timeline has everything exactly once. The
other lead is kept (hidden) and the merge can be **undone for 7 days** from the lead page.

## Batches

Cards show seats taken against the real cap (40 per batch is the camp's only scarcity), the close-date
countdown, what the students owe and what has been collected. A batch's page lists its students with their
plan, status, how much is paid and the next installment date. Every deadline anywhere in the CRM and in
templates comes from these records: templates cannot contain a typed date.

## Proof bank

**Proof bank** (sidebar > Programme) lists every quote, QC result, screenshot and video candidates gave, from
the Notion Proof & Testimonial Bank. An item says **Ready** only when its consent is Granted and the
candidate's content consent is on file; use only those in content, word for word, and never as a promise of
income. Filter by consent, type or batch.

## Finance (owner and finance)

**Finance** in the sidebar is the camp's books, following the rules on the Notion *Finances* page:

* **Net income** = money received (candidate payments and OrlaDent client work) − refunds.
* It is split **Badr 30% · Sayyed 20% · Retro 15% · Mo 15% · Capital 20%** (owners change this in
  Settings > Finance split; it must add up to 100).
* **Costs** (fixed and variable, once paid) come out of **Capital**. "Capital left" = Capital's share − costs.
* A **partner withdrawal** is an advance on that partner's share. Each partner card shows this month's share,
  what they have withdrawn and the **balance** they can still take (all shares to date − all withdrawals).
* **Expected** and **Owed** rows do not count until they are marked Received or Paid. Cancelled never counts.
* A row belongs to the month of its date (Cairo time); a row without a date to the month it was added.

Three tabs:

* **Overview**: pick a month; received, costs, net, Capital left; the partner cards; 12 months of received vs
  costs (with a table view); where the money went; **Coming up** (expected installments and unpaid bills, with
  one click to mark them done); how much of what candidates owe has been collected.
* **Candidates**: every enrolled student's due, paid, remaining and next installment; filter by batch, still
  owing, overdue, paid in full.
* **Ledger**: every row, searchable and filtered by month, kind and status; add, edit, mark done, delete (it
  asks first). **+ Payment / Client work / Expense / Withdrawal** buttons add the common rows in one step.

Money is never moved by the CRM: it only records what happened. Candidates pay OrlaDent directly (InstaPay or
bank transfer); keep the transfer or receipt reference on the payment.

## Notion

When the server has a Notion token (set up once, below), the CRM and the camp's Notion stay in step every
minute. **Settings > Integrations** shows what is linked, the last runs and any problems, and has **Sync now**.

| Notion | CRM | Direction |
| --- | --- | --- |
| Batches | Batches | both ways; the Enrolled counts are written by the CRM |
| Candidates | enrolled students | both ways (tier, plan, status, discount, installment dates, notes, name, Gmail, number). A candidate added in Notion with a Batch and a Tier becomes an enrolled lead in the CRM |
| Candidates: Consent on file?, Consent scope, QC score, Leaderboard rank | a student's **Programme** card | both ways |
| Ledger | Finance ledger | both ways; the payment reference stays in the CRM only; **Team member** is linked too |
| Sessions | Programme card > Sessions | both ways |
| Proof & Testimonial Bank | Programme card > Proof, and the **Proof bank** page | both ways |
| Team | the "Paid to" list on costs | Notion to CRM only: name, role, group, status, contact. Pay and equity are never copied |
| CRM Leads (created by the sync) | leads | CRM to Notion; only name, email and notes come back. Stages are changed in the CRM |

* When the same record was changed on both sides between two syncs, the **newer edit wins** (shown as a
  conflict in the run log).
* Deleting a ledger row in Notion deletes it in the CRM (and the other way round). Other pages deleted in
  Notion stay in the CRM and are no longer synced (the run log says so).
* Notion's formulas (Tier price, Amount paid, the partner columns) keep working: the sync fills the same
  columns you fill by hand. A tier changed in Notion takes the list price (7,500 / 15,000 / 30,000 EGP).
* Rows Notion cannot map (a ledger row without a Section, a candidate without a Batch or Tier) are listed as
  problems and left alone.

**Setting it up (once, by whoever runs the server):** create an internal integration at
notion.so/my-integrations (read, update and insert content), copy its token, then in Notion open the
*OrlaDent Camp* page > ⋯ > Connections and add the integration. Put the token in `.env` as `NOTION_TOKEN` and
restart. The first sync links rows that already exist on both sides (same batch name; same candidate phone,
email or name in the same batch; same ledger amount, date and category) instead of copying them twice.

## Dashboard

Date presets (30 days, 90 days, all time) or a range, plus source, campaign, segment, owner, batch. Revenue,
leads, enrolments, median first contact; the funnel; speed to lead; **lost: said no vs no decision**; weekly
trend (three small charts, with a table view); consults and sales cycle; revenue by tier, batch and source;
source quality; top objections. Hover or Tab onto a bar for its exact value. **Anything based on fewer than 5
leads shows the raw count ("2 of 3") instead of a percentage.** Definitions: `METRICS.md`.

## Roles

| Role | Can |
| --- | --- |
| **owner** (Retro, Badr, Sayed) | everything: leads, settings, users, audit log, Finance, override a full batch, override exit criteria |
| **sales** | create and edit leads, activities, follow-ups, consults and enrolments; cannot delete, change settings or manage users |
| **viewer** | read only |
| **finance** (Mo) | read everything, Finance (record payments, costs, withdrawals), export revenue; cannot edit leads or settings |

## Owners: Settings

* **Users**: add people, change roles, deactivate, reset a password. There is always one active owner.
* **Stages & criteria**: rename and reorder stages, add a stage (a warning past 7 open stages; names that are
  time periods like "Q4 deals" are refused), and switch each stage's checks on or off.
* **Thresholds & routing**: response-time target, amber and red; working hours (off by default); neglected and
  stale days; decision-due days; the default owner for new leads and routes by source or segment.
* **Workflows**: the rules, each with an on/off switch, editable wording and delays, a form for new rules, and a
  run log of what fired. Built in: new lead → reply task + notification; reply → stop the cadence + reply task;
  consult "thinking" → post-consult cadence; no-show → recovery task in 2 hours; offer sent → decision-day task;
  follow-up 24h overdue → notify; lost → cancel follow-ups, price/timing to nurture review; unassigned lead past
  red → alert owners. **Rules never send messages.**
* **Message templates**: add, edit, archive; see how often each is used. Prices, incentives and claims need
  Badr's approval before they go into a template.
* **Finance split**: the partners and percentages that net income is split by (with Capital, 100% in total).
* **Integrations**: the Notion sync status, the run log and **Sync now**.
* **Sources & reasons**, **Cadences**, **Audit log** as before.

## Good habits

* Log first, then move on. A lead you did not log is a lead the numbers cannot see.
* End the day with "No next step" empty.
* Move a stage when the buyer did something, not when you feel hopeful.
* Never share exports or screenshots with student details outside the team.
* Set your own password the first time you sign in.
