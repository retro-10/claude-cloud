# User guide

For everyone using the CRM. The goal is simple: **never lose a lead, always know who to contact today, and log
everything** so the numbers are true.

## The daily routine (10 minutes to set up, then part of the day)

1. **Open Today** (the home screen). Everything that needs you is on it; nothing has to be searched for.
2. **Clear "Uncontacted new leads" first.** The badge shows how long each has been waiting: green under 5
   minutes, amber from 5, red from 30. Press **WhatsApp** to open the chat, send your message, come back and
   press **Sent**. That logs it, stamps the first-contact time (this is what "reply within 5 minutes" is
   measured on) and takes the lead off the list.
3. **Do "Overdue follow-ups", then "Follow-ups due today".** For each one: **WhatsApp**, send, then **Done**
   (or **Sent** to also log the message). Can't do it today? Pick a new date and press **Move**. The grey line
   under a cadence follow-up is a *suggestion* for what to say; nothing is ever sent for you.
4. **Check "Consults today"** and, after each one, record the result on the lead's page (below).
5. **Look at "Decisions due".** These are people who got an offer 3 or more days ago and have not answered.
   Nudge them, or decide they are lost.
6. **Log everything.** When they reply, log it (Timeline box on the lead, type `whatsapp`, direction `in`).
   That is what stops the scripted follow-ups, keeps "first reply" true, and feeds the dashboard.

Use **Show only mine** at the top of Today to see just your own leads.

## Adding a lead (under 10 seconds)

Press **n** (or **+ Lead**), type the name and WhatsApp number, pick the source, press Add. Numbers can be
written any way (`010…`, `+20 10…`, Arabic digits). If the person already exists (same phone or email) you are
told and given a link to them instead of a duplicate. Names and notes can be in Arabic or English.

## A lead's page

* **Stage** and **Lost reason**: Lost needs a reason. Enrolled is done from the Pipeline (it needs cohort, tier,
  amount).
* **Follow-ups**: add one (date, kind, note) or **Start cadence** to create a whole scripted sequence (for
  example *Outreach, 14 days*: days 0, 1, 4, 8, 12, 14). A cadence **stops by itself** when the lead replies or
  becomes Enrolled or Lost. Follow-ups you added by hand are never cancelled.
* **Consults**: book a date and time (Cairo time). Afterwards press **Record result**: held or no-show, the
  outcome, and which objections they raised (price, time, trust…). Booking and holding a consult moves the lead
  forward in the pipeline for you.
* **Timeline**: everything in one list. Use *Log activity* for every call, message and note.
* **WhatsApp** button opens a chat with the number in one click.

## Pipeline (board)

Columns are the stages. **Drag a card** to move it, or use **Move to…** on the card (on a phone). Moving to
**Lost** asks for a reason. Moving to **Enrolled** asks for the cohort, tier and amount (the list price is
filled in; Production Partner is custom). A red card has an overdue follow-up.

## Leads list

Search by name, phone, email or notes (`/` jumps to the search box). Filter by stage, source, segment, tier,
owner, date, and "overdue follow-up". **Save view** remembers a filter. Tick leads to **move stage, assign an
owner or start a cadence** for many at once. **Import CSV** brings in a ClickUp export or a scraped list: match
the columns, press Preview to see what would happen (nothing is saved), then Import. Importing the same file
again never creates duplicates. **Export CSV** downloads what you are looking at. Exports contain personal
data: keep them private.

## Cohorts

Each intake has a masterclass date, an enrolment close date with a countdown, a seat cap (set it to the real
capacity) and a list of students with what they paid. The cap cannot be exceeded without an owner's explicit
override. Finance and owners can edit payment details and export a cohort's enrolments.

## Dashboard

Pick a date range and any of source, campaign, segment, owner, cohort. It shows the funnel (how many leads ever
reached each stage and what share moved on), speed to first contact, consult show-up and consult-to-enrolment
rates, sales-cycle length, revenue by tier / cohort / source, the main reasons leads are lost and objections
raised, source quality, and a weekly trend. **Anything based on fewer than 5 leads shows the raw count ("2 of
3") instead of a percentage**, because a percentage of three people means nothing.

## Roles

| Role | Can |
| --- | --- |
| **owner** (Retro, Badr, Sayed) | everything: leads, settings, users, audit log, override a full cohort |
| **sales** | create and edit leads, activities, follow-ups, consults and enrolments; cannot delete, change settings or manage users |
| **viewer** | read only |
| **finance** (Mo) | read everything, edit payment details, export revenue; cannot edit leads or settings |

## Owners: Settings

Top navigation > **Settings**: **Users** (add people, change roles, deactivate, reset a password), **Pipeline
stages** (rename and reorder), **Sources & reasons** (sources, lost reasons, objection tags, campaigns; a label
in use can be renamed but not deleted), **Cadences** (edit the scripted sequences), **Audit log** (who did what
and when; it never contains lead names, numbers or message text). There is always at least one active owner.

## Keyboard and accessibility

`n` new lead, `/` search (on the Leads page), `Esc` closes a dialog, `Tab` moves through everything; the first
Tab stop is "Skip to content". Dark and light themes (toggle top right) both meet WCAG AA contrast. The app
works on a phone browser.

## Good habits

* Log first, then move on. A lead you did not log is a lead the numbers cannot see.
* Fix dates rather than deleting follow-ups: history is what makes the dashboard honest.
* Never share exports or screenshots with student details outside the team.
* Set your own password the first time you sign in.
