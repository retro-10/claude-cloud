# User guide

For everyone using the CRM. The goal: **reply fast, give every open lead a dated next step, move a deal only
when the buyer moved, and log everything** so the numbers are true.

## Finding your way

* **Sidebar** (left; on a phone, **More** at the bottom): **Command centre** and **Tools** first, then Today,
  Leads, Pipeline, Tasks, Batches, Dashboard, then **Views** with live counts (see below), then Settings for owners.
* **Ctrl K** (⌘K on a Mac), or the search box at the top of the sidebar, opens the **command palette**: type part
  of a name or a phone number in any format (`0100 777 66`, `+20 100…`, Arabic spelling variants are matched) to
  jump to a lead, or type a command ("new lead", "pipeline", "dark theme", "sign out").
* **Keyboard**: `n` new lead · `/` search on the page · `g` then `o` / `t` / `l` / `p` / `k` / `c` / `d` / `s` goes to
  Command centre, Today, Leads, Pipeline, Tasks, Batches, Dashboard, Settings · `?` shows every shortcut · `Esc`
  closes a dialog.
* The **bell** (top right) holds notifications from the workflow rules: a new lead arrived, a follow-up is 24
  hours overdue, nobody has answered an unassigned lead.
* Sun/moon icon: light or dark theme (remembered per browser).

## Command centre (start here)

The first screen of **OrlaDent OS**. Open it every morning.

* **Pulse**: the last 7 days against the 7 before: new leads, consults held, enrolments, cash collected (owners and
  finance only), tasks done and production cases delivered. A rolling week, so Monday and Thursday compare the same way.
* **Needs a person**: one list of everything waiting on someone, urgent first. It includes new leads past the red
  time, replies waiting on us, overdue follow-ups, decisions due, leads with no next step, overdue tasks, and
  batches whose enrolment closes within 14 days with seats left. Owners and finance also see overdue instalments
  and bills past due; owners see Notion sync problems. Click a line to go straight to the list behind it.
  Phase 4 adds: decisions and checklists past their date (everyone); jobs nobody does (owners); production
  cases past due (owners and finance), waiting for QC or for a designer (owners); client invoices overdue and
  categories over this month's budget (owners and finance).
* **Targets**: this quarter's targets with a bar each and pace: *on track* (at or above where an even quarter
  would be), *at risk* (within 20% of it), *behind*, *reached*, *missed* (quarter over). Owners set them in
  **Settings > Targets**.
* **My tasks this week** and the **Weekly review**. Owners write the review after the weekly meeting: wins,
  misses and why, decisions (who does what by when), and notes. Saving keeps that week's numbers with it, so
  old reviews read the same later. Use the arrows to look at earlier weeks. Weeks run Monday to Sunday.

## Tasks

Everything the team has to do that is not a follow-up with a lead: prepare a masterclass, chase a certificate,
edit a reel, pay a supplier. A task has a title, who, a due date, a priority and notes. It can belong to a lead
(or student), to a batch, or to nothing.

* **Tasks** in the sidebar shows your open tasks (the count turns red when one is overdue). Tabs: Mine, Everyone,
  Unassigned, Done; filter by due date.
* A lead's page and a batch's page each have a **Tasks** card with **Add task**.
* **Done** finishes a task, **x** cancels it (kept for the record), and a finished task can be reopened. Viewers
  can see tasks but not change them.
* Tasks move with a lead when two leads are merged.

## Files

A lead's page and a batch's page have a **Files** card: receipts, certificates, IDs, contracts, case files.
Up to 8 MB each. Accepted: PDF, images (PNG, JPG, WebP, GIF, HEIC), Word, Excel, PowerPoint, CSV, text, ZIP, and
dental files (STL, PLY, OBJ, DICOM). Share videos by link in a note instead. Photos open in the browser;
everything else downloads. Every download is recorded in the audit log. The person who added a file, or an
owner, can delete it; deleting removes the file itself.

Patient cases: only upload what the patient agreed to, and prefer files without names or faces.

## Tools

* **Offer builder**: pick the programme, price, discount and plan (in full, or a deposit then 1 to 6 monthly
  instalments). You see the schedule (equal parts rounded to 50 EGP; the last one takes the remainder) and a
  ready WhatsApp message. Open it from a lead (**Offer builder** on the lead's Offer card) to open WhatsApp with
  the message and **save the offer on the lead**. The message is factual on purpose: no deadlines, incentives or
  results promises unless Badr approved them.
* **Campaign ROI**: before you spend, what a budget should bring (leads, consults, enrolments, revenue) at a
  cost per lead and your own rates, and the **break-even cost per lead**: pay more than that per lead and the
  campaign loses money.
* **Tracked links**: see Growth above.
* **Pricing scenarios** (owners and finance): a batch "as it is" next to "what if": price, average discount,
  seat cap, seats filled, free seats, the batch's costs and a cost per student. You see revenue, costs, margin,
  the margin if every seat fills, and how many paying students cover the costs. **Start from a batch** fills
  the left side with that batch's real numbers.
* **Turnaround quote**: see Production studio below.
* **Batch planner**: pick a batch; it shows how many new leads and held consults you need, in total and per
  week, to fill the free seats before enrolment closes. The conversion rates and average price start from the
  last 180 days of your own data (or cautious placeholders while there are fewer than 30 leads); change them to
  test a plan.

## Growth (campaigns, forms, masterclasses, content, referrals)

**Campaigns** (Growth > Campaigns): one per masterclass, ad run, collaboration or event. Give it a type,
status, dates, a budget and a **link name** (like `masterclass-oct-2026`). The list shows what each brought:
leads, how many held a consult, how many enrolled. Owners and finance also see the money: spend (the ledger
costs tagged to the campaign, recorded straight from the campaign page with **Record cost**), cost per lead, cost
per enrolment, revenue from its students and the return on spend.

**Lead forms** (Growth > Lead forms): public sign-up pages at `/f/<address>`, in English and Arabic, for a
masterclass, an ad or your link in bio. Choose the campaign, the source and the questions. A sign-up arrives as
a new lead, with the new-lead rules (reply task, notification) and their WhatsApp consent recorded. Someone we
already have is linked to their existing lead, never duplicated; they see the same thank-you either way.
Spam protection is built in (a hidden trap field, a page timer, 5 sign-ups per connection per 10 minutes).

**Tracked links** (Tools > Tracked links): make a link (and QR code) for each post, story, ad or flyer. The tags
in the link travel onto the lead: the lead's page shows *Came from: instagram · story · reel-7*, and a link with
a campaign's link name files the lead under that campaign.

**Leads from ads tools**: Meta lead ads (through Zapier or Make) or a partner site can send leads to
`POST /api/inbound/leads` with the token from `INBOUND_LEADS_TOKEN` (whoever runs the server sets it). Same
handling as the forms.

**Masterclasses** (Growth > Masterclasses): every campaign of type Masterclass or Event. Its page lists the
registrants (its form sign-ups, its tagged leads, and anyone you register by WhatsApp number). For each person,
the green button opens WhatsApp with the reminder filled in; the tick marks them reminded (logged as a WhatsApp
sent). After the event mark who came, press **Save attendance**, then start a cadence for those who came (or did
not) in one click. The list shows show-up rate, consults after the event and enrolments.

**Content** (Growth > Content): the content calendar. Plan a piece (platform, format, date, owner, campaign,
brief, caption) on the month view; undated ideas sit beside it. The **Board** moves pieces through idea,
scripting, filming, editing, scheduled, posted. Each piece has a tag; its page shows a ready tracked link, and
the leads that came through it. In the **Proof bank**, items marked Ready (consent granted) have **Make content**:
it creates an idea with the quote word for word and what the consent covers.

**Referrals** (Growth > Referrals): on a student's or graduate's page, **Make referral link** in the Referrals card
gives them a link with their code. Anyone who signs up through it is marked as referred by them (you can also
set *Referred by* by phone number). When someone referred enrols, a reward appears to decide: owners and finance
set the amount (nothing is pre-filled: the reward rules are Badr's), approve it, and mark it **Paid**, which
records a *Referral rewards* cost in the ledger.

The Command centre also lists content past its publish time and rewards waiting for a decision.

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
  price, discount or student status (Active, Graduated, Dropped). **Dropped** stops the balance: the student owes
  nothing more, their open installments are cancelled, and revenue counts only what they paid (less refunds).
  Owners and finance only.
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
CSV** (owners only: the file holds names, phones and emails) work as before; imports of past data are not checked against exit criteria and do not fire rules.

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

## Programme (classes, assignments, graduation, alumni, student portal)

**Classes** (Programme > Classes): each batch's schedule. Add a class (batch, title, module, date and time in
Cairo time, length, instructor, place, recording and materials links). **Copy a schedule** repeats another
batch's classes in the same order and gaps from a first date you choose (recordings are not copied).
Instructors see **Mine** for their own classes. On a class's page mark each student Present, Late, Absent or
Excused and press **Save attendance**. After a student's second unexcused absence in a batch, a high-priority
task "Check in with … (missed classes)" is made once for whoever marked it. The Command centre lists classes
held in the last 7 days that nobody marked.

**Assignments** (Programme > Assignments): give the batch, a brief, a due date, the pass mark and a rubric, one
criterion per line as `name | points` (for example `Fit | 60`). Students send their work from the portal, or
you record it for them (a file or a link) with **Record a submission**. Review it by scoring each criterion and
writing feedback: at or above the pass mark it is **Passed**, below it **Needs rework**, and the student may send
again (a new attempt; the old feedback stays visible until the new review). Each review updates the student's
**QC score** and the batch **leaderboard**. The Command centre counts submissions waiting for review.

**Graduation** (a batch's page > **Graduation**): set the batch's rules (minimum attendance, every assignment
passed, paid in full) and see each student against them, with what is missing in words. **Graduate and issue
the certificate** marks them Graduated, issues a certificate with a code like `OC-BSQ8-7JYX`, opens their alumni
profile and gives them a referral code. A student who does not meet the rules graduates only when an owner
types the reason; the reason is kept with the certificate. Owners can revoke a certificate (with a reason).

**Certificates**: open one to print it or save it as a PDF. Its QR code and link lead to `/c/<code>`, a public
page anyone (a clinic, an employer) can use to check it is genuine: it shows the name, programme, batch and date,
or that it was revoked. It shows nothing else about the student.

**Alumni** (Programme > Alumni): every graduate, with a headline, skills, availability for paid work and a
portfolio link. Filter by availability or skill to find someone for a job or a case.

**Student portal**: on an enrolled student's page, the **Student portal** card > **Give portal access** shows a
one-time invite link (valid 7 days; shown once, so copy it and send it on WhatsApp). The student opens it, sets
a password, and from then on signs in at `/portal/login` with their WhatsApp number. On their phone they see
their attendance, QC score, rank, what is left to pay, the next classes, their assignments with scores and
feedback (and can send work), their payments and their certificate. They see only their own things. **Switch
off** stops their access at once; a new invite resets the password and signs out the old sessions. The portal
is separate from staff sign-in: a student can never open a staff page.

## Production studio (client work)

**Production** in the sidebar is OrlaDent's design work for clinics and labs.

* **Price list**: each kind of case (a crown, a bridge unit, a smile design) with its price per unit, the
  designer's pay per unit, the turnaround in working days (standard and rush; Fridays are off), the rush
  surcharge and the **QC checklist** it is checked against (one item per line).
* **Clients**: each clinic or lab with contacts, their discount on the price list and how many days they have
  to pay an invoice. A client's page shows their cases, invoices and what they owe.
* **Cases**: the board, by stage: Received → Assigned → Designing → QC → Delivered (then Invoiced). **Take a
  case in** with the client, case type, units, rush or not, and the client's own reference (never a patient's
  name). The price (price list, rush surcharge, client discount) and the due date (working days from the day it
  arrived, by 18:00) are fixed then; change the due date on the case if you agreed another.
* **A case's page**: assign it to a designer; the designer presses **Start designing**, adds the design files
  (STL, PLY, OBJ, ZIP… up to 8 MB each) and **Send to QC**. Someone other than the designer ticks the QC
  checklist: all ticked passes it; anything not ticked sends it back to the designer with what to fix (it counts
  against their first-time pass rate). **Mark delivered** once it is sent to the client; the designer's pay is
  then added to the ledger as owed (Production designers).
* **Designers**: each designer's open cases, and over the last 90 days: delivered, passed QC the first time,
  delivered on time, average turnaround and pay earned.
* **Quote**: before taking a case in, a client's price and delivery date for a case type, units and rush, with
  a message ready to send.
* **Invoices** (owners and finance): **Invoice** a client's delivered cases (all of them from the Invoices tab,
  or the ones you tick on the client's page). Each invoice is numbered INV-year-0001, due after the client's
  terms, and is in the ledger as expected client work. **Record payment** for all or part of it; each payment
  has a receipt. **Print or PDF** gives the invoice to send. An invoice issued by mistake can be voided before
  anything is paid on it; its cases go back to Delivered. Owners set the business name, address, tax number and
  how to pay in **Settings > Finance**: they are printed on every invoice and receipt.

**Designers** (role *designer*) see only the production studio and only the cases given to them: no leads, no
students, no prices; only their own pay per case. Their sign-in opens on their cases.

## The AI assistant (Ask OrlaDent, drafts, briefs)

The assistant is **off until an owner switches it on** in **Settings > AI assistant**, and it needs an
Anthropic API key on the server (see the README). It uses Claude, made by Anthropic.

* **Ask OrlaDent** (sidebar, under OrlaDent OS): ask about leads, batches, campaigns, students, production or
  money in plain words, in English or Arabic. It looks the answer up in the app and links to the records, e.g.
  *"Which source brought the most enrolments this quarter?"*, *"Who is waiting longest for a reply?"*,
  *"Which students in Batch 7 are likely to drop?"*. Each answer shows what it **looked at**. It only reads: it
  never changes, moves or sends anything. Your conversations are yours; others cannot see them.
* **WhatsApp drafts**: in the message composer, choose **AI draft**, then **Draft a reply** (to their last
  message) or **Draft a follow-up** (they went quiet), in Arabic or English. Edit it, then **Open in
  WhatsApp** as usual: you press send there.
* **Hooks and caption** on a content piece, **Run-of-show script** on a masterclass, **Draft this week's
  review** on the Command centre (then **Put it in the review form**, check it, save), and **Brief me for the
  call** on a lead with a consult coming up (also from **Brief** next to Today's consults).
* **Early warning** (no AI, always on): each batch page lists active students likely to drop, with the reasons:
  attendance under the batch's minimum, missed the last classes, work past due, rework not redone, an overdue
  instalment (that last one only for owners and finance). Students at risk also show in the Command centre.

**The rules it works by**

* It sees only what **you** may see in the app, and only the kinds of data owners allow (Settings > AI
  assistant: leads and conversations, money, students, production). Money is off until an owner turns it on,
  and even then only owners and finance get it.
* **Phone numbers and email addresses are never sent**, not even inside notes and messages.
* **Every draft is a draft.** Nothing is sent or posted by the app. Drafts may not add prices, dates, discounts,
  results or promises that are not in the app; where something is missing they leave a [placeholder].
* It can be wrong. Check the figures and the linked records before acting on them.
* Each person has a daily limit (100 requests by default). Owners see requests and the estimated cost per month
  on the settings page. Only the number of tokens is recorded, not what was asked.

Designers do not have the assistant. Drafting messages and briefs needs permission to work leads (owners and
sales); captions and scripts need growth (owners and sales); the weekly review is for owners.

## Team & operations

**Team & ops** (sidebar, under OrlaDent OS):

* **Responsibilities**: each recurring job (reply to new leads, post daily, QC every case, chase instalments)
  with how often, who **does it** and who **answers for it** (and who is consulted or kept informed). A job
  with nobody active doing it is flagged, here and in the Command centre.
* **Playbooks**: how we do the jobs that come back (onboard a student, run a masterclass, close a batch,
  deliver a case), one step per line. **Start the checklist** for a batch, from a playbook's page, or for a
  person from **Run a playbook** on their lead page. Tick each step as it is done; the checklist completes when
  every step is ticked. Changing a playbook later does not change checklists already started.
* **Checklists**: the playbooks being run now (with how far along) and those finished; **Mine** for yours.
* **Meetings**: the date, who was there, the agenda, notes, and the **decisions** taken.
* **Decisions**: what was decided, its owner and the date it should be done by. Open decisions past their date
  show in the Command centre. The decision's owner (or an owner of the business) closes it as **Done** (with
  what happened) or **Dropped**.

Owners write responsibilities, playbooks, meetings and decisions; anyone who works runs checklists.

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
  A cost can be tagged to a batch (**For batch**) so it counts in that batch's margin. Received payments have a
  **Receipt** button: a printable receipt (save it as a PDF to send).
* **Budget**: for each month, what each cost category may spend. Next to it: what was paid and what is owed in
  that month, what is left, and a bar per category. Over budget, or spent with no budget, shows in red and in
  the Command centre. **Copy last month's budget** starts a new month.
* **Cash forecast**: the next 13 weeks from today, week by week: money due in (instalments, open invoices),
  money owed out (costs, withdrawals), and the part of each month's budget not booked yet. Type the cash you
  hold today to see the balance week by week and its lowest point. Rows already past their date and still open
  are listed apart, not assumed.
* **Unit economics**: for the last 30 days, 90 days or 12 months: marketing spend (ads, referral rewards and
  any cost tagged to a campaign), cost per lead and per enrolment, revenue per enrolment; each batch's revenue,
  tagged costs and margin; each kind of production case's revenue, designer pay and margin.

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
| Team | Settings > Team, and the "Paid to" list on costs | both ways: name, role, group, status, contact, duties. Salary, equity, payment schedule and compensation notes stay in Notion only and are never overwritten |
| **Leads** (under OrlaDent Camp) | leads | both ways. **Add a row in Notion** (Name and Phone at least; Email, Source, Segment, Tier interest, Notes if you have them) and within a minute it is a lead in the CRM: the phone is cleaned up (01012345678 becomes +201012345678), duplicates are linked instead of copied, and it is routed to an owner. Stage, Owner, Created, Decision due and Open in CRM are set by the CRM |

* When the same record was changed on both sides between two syncs, the **newer edit wins** (shown as a
  conflict in the run log).
* Deleting a ledger row in Notion deletes it in the CRM (and the other way round). Other pages deleted in
  Notion stay in the CRM and are no longer synced (the run log says so).
* Notion's formulas (Tier price, Amount paid, the partner columns) keep working: the sync fills the same
  columns you fill by hand. A tier changed in Notion takes the list price (7,500 / 15,000 / 30,000 EGP).
* Rows Notion cannot map (a ledger row without a Section, a candidate without a Batch or Tier) are listed as
  problems and left alone.

**Going live with real data:** a fresh install has no demo data (`SEED_DEMO=false`). If yours still shows
"Demo Lead" contacts, open **Settings > Integrations > Remove demo data** (owners): every demo lead, demo
batch and DEMO money row goes, real data is untouched. Their copies in Notion are archived too (restore them
from Notion's trash if you need them), so they never come back on a later sync. After the first sync, your real candidates, batches
and payments come in from Notion with their real numbers.

**Setting it up (once, by whoever runs the server):** create an internal integration at
notion.so/my-integrations (read, update and insert content), copy its token, then in Notion open the
*OrlaDent Camp* page > ⋯ > Connections and add the integration. Put the token in `.env` as `NOTION_TOKEN` and
restart. The first sync links rows that already exist on both sides (same batch name; same candidate phone,
email or name in the same batch; same ledger amount, date and category) instead of copying them twice.

## Dashboard

Date presets (30 days, 90 days, all time) or a range, plus source, campaign, segment, owner, batch. Revenue,
leads, enrolments, median first contact; the funnel; speed to lead; **lost: said no vs no decision**; weekly
trend (three small charts, with a table view); consults and sales cycle; revenue by tier, batch and source;
source quality; top objections. Revenue figures are shown to owners and finance only. Hover or Tab onto a bar for its exact value. **Anything based on fewer than 5
leads shows the raw count ("2 of 3") instead of a percentage.** Definitions: `METRICS.md`.

## Roles

| Role | Can |
| --- | --- |
| **owner** (Retro, Badr, Sayed) | everything: leads, settings, users, audit log, Finance, override a full batch, override exit criteria |
| **sales** | create and edit leads, activities, follow-ups, consults and enrolments; cannot delete, export the lead list, see revenue, change settings or manage users |
| **viewer** | read leads only (no revenue, no lead export) |
| **finance** (Mo) | read everything including revenue, Finance (record payments, costs, withdrawals), export revenue; cannot edit or export leads, or change settings |
| **instructor** | read leads; run the programme: classes and attendance, assignments and reviews, graduation, alumni, portal invites; add tasks and files. No revenue, no lead editing, no settings |
| **designer** | only the production studio, and only the cases assigned to them: start, add the design files, send to QC; their own pay per case. No leads, students, prices or settings |

Ask OrlaDent: everyone except designers, each seeing only what their role sees.

Tasks and files: owner, sales and finance add and finish them; viewers only look. Growth (campaigns, forms,
masterclasses, content, referral links): owners and sales. Campaign costs and referral rewards: owners and
finance. Programme (classes, attendance, assignments, graduation, alumni, portal access): owners and instructors;
graduating a student who does not meet the rules: owners only. Production studio: owners run it (clients, price
list, intake, assignment, QC, delivery); finance sees it and invoices; designers work their own cases. Team &
ops: owners write it; everyone who works runs checklists and closes their own decisions. Budgets: owners and
finance.

## Two-factor sign-in

**My account > Two-factor sign-in** adds a second step after the password: a 6-digit code from an
authenticator app (Google Authenticator, Microsoft Authenticator, 1Password and similar). Someone who learns
your password still cannot get in. Owners and finance see a reminder until it is on.

1. Press **Set up two-factor sign-in**, scan the QR code with the app (or type the key), and enter the code
   the app shows.
2. You get **10 recovery codes**, shown once. Save them somewhere safe that is not your phone. Each one signs
   you in once if the phone is lost. You can make new ones later (the old ones stop working).
3. From then on, signing in asks for the password, then the code. Five wrong codes lock the step for a few
   minutes.

Lost your phone and your recovery codes? An owner opens **Settings > Users** and presses **Reset two-factor**
for you; you sign in with your password and set it up again. Turning it off yourself needs a current code.
If the server's `AUTH_SECRET` is ever changed, everyone's two-factor must be reset this way.

## Owners: Settings

* **Users**: add people, change roles, deactivate, reset a password, see who has two-factor on and reset it
  for a lost phone. There is always one active owner.
* **Targets**: what this quarter and next should deliver (new leads, consults held, enrolments, revenue, cash
  collected). Empty means no target. Progress shows on the Command centre.
* **Stages & criteria**: rename and reorder stages, add a stage (a warning past 7 open stages; names that are
  time periods like "Q4 deals" are refused), and switch each stage's checks on or off.
* **Thresholds & routing**: response-time target, amber and red; working hours (off by default); neglected and
  stale days; decision-due days; the default owner for new leads (Retro, unless you change it; blank means whoever
  adds the lead) and routes by source or segment.
* **Workflows**: the rules, each with an on/off switch, editable wording and delays, a form for new rules, and a
  run log of what fired. Built in: new lead → reply task + notification; reply → stop the cadence + reply task;
  consult "thinking" → post-consult cadence; no-show → recovery task in 2 hours; offer sent → decision-day task;
  follow-up 24h overdue → notify; lost → cancel follow-ups, price/timing to nurture review; unassigned lead past
  red → alert owners; a lead given to someone → tell them. **Rules never send messages.**
  **Making a rule**: pick *When*, then *Only if* (only the conditions that event can have are shown: stage becomes
  or was, consult result or outcome, lost reason, segment, source, tier, a tag, no owner), then up to five actions
  in order (follow-up, notify, give the lead to someone, tag, start or stop a cadence, cancel follow-ups). Rules you
  made can be changed completely; built-in ones keep their shape. Each rule shows how often it fired in the last 30
  days and any failures; the run log filters by rule and by failures. A rule that fails is undone and logged; it
  never stops the lead being saved. A rule adds at most one open "reply" follow-up per lead, and never a second copy
  of its own open follow-up.
* **Message templates**: add, edit, archive; see how often each is used. Prices, incentives and claims need
  Badr's approval before they go into a template.
* **Finance split**: the partners and percentages that net income is split by (with Capital, 100% in total).
  Below it, **On invoices and receipts**: the business name, address, tax registration number, phone, email,
  how to pay and a footer, printed on every production invoice and payment receipt.
* **AI assistant**: switch it on or off, choose what it may look up (leads, money, students, production), the
  brand voice drafts are written in, the daily limit per person, and this month's requests and cost.
* **Integrations**: the Notion sync status, the run log and **Sync now**.
* **Sources & reasons**, **Cadences**, **Audit log** as before.

## Good habits

* Log first, then move on. A lead you did not log is a lead the numbers cannot see.
* End the day with "No next step" empty.
* Move a stage when the buyer did something, not when you feel hopeful.
* Never share exports or screenshots with student details outside the team.
* Set your own password the first time you sign in.
