# Metrics and definitions

Every number in the CRM, what it means, and where the query lives. Conversion numbers come from
`stage_events` (history), never from current stage counts. Times are Cairo. **Fewer than 5 records: the count
is shown ("2 of 3"), never a percentage.** Deleted and merged-away leads are excluded everywhere.

## Dashboard (`src/lib/metrics.ts`, `getMetrics`)

The filters pick a set of leads (created in the date range and matching source, campaign, segment, owner;
cohort = enrolled in it). Every figure below is computed over those leads and their own history.

| Metric | Definition |
| --- | --- |
| Leads | leads in the selection |
| Funnel, stage N | leads that ever entered stage N (a `stage_events` row with `to_stage` = N); the percentage is stage N / stage N-1 |
| Median first contact | median of `first_contact_at - created_at` over contacted leads |
| Contacted within 5 minutes | contacted within 5 minutes / all leads in the selection (QUESTIONS.md #19) |
| Show-up rate | held / (held + no-show); consults still to happen are ignored |
| Consult to enrolment | leads with a held consult who enrolled / leads with a held consult |
| Sales cycle | median days from creation to the first event into Enrolled |
| Revenue / collected | what the enrolled students owe (price − discount; a free seat owes 0; a dropped student only what they paid, net of refunds) / what they have paid (Received candidate payments in the ledger, minus refunds) |
| Lost: said no vs no decision | lost leads by the kind of their lost reason (`lost_reasons.kind`: `explicit` or `no_decision`) |
| Top lost reasons, top objections | counts, ties alphabetical, top 5 |
| Source / campaign quality | leads, enrolled, enrolled / leads |
| Weekly trend | new leads, consults (by scheduled date) and enrolments per week starting Monday |

Hand-checked answers for the 20-lead demo dataset are asserted in `tests/metrics.integration.test.ts`.

## Response time (C3, `src/lib/speed.ts`)

* Waiting time = now (or first contact) minus `created_at`. With **working hours** on (Settings), only minutes
  inside the window on working days count.
* Colour: green below amber (default 5 min), amber below red (default 30 min), red after.
* The **response queue** on Today = open leads with no first contact, plus leads with an open "reply" task
  (created when they reply); waiting time starts at creation or at their reply.

## Lead health and smart views (`src/lib/views.ts`)

All definitions apply to live leads. "Open" = a stage of kind `open` (New through Offer sent).

| View / flag | Definition |
| --- | --- |
| Uncontacted | open, `first_contact_at` is null |
| No next step | open or nurture, no follow-up that is neither done nor cancelled |
| Neglected | open, latest activity (or creation) older than the neglect threshold (default 14 days); future follow-ups are ignored on purpose |
| Stale | open, latest stage event (or creation) older than the stale threshold (default 30 days) |
| Days in stage | now minus the latest event into the current stage |
| Decision due | in Offer sent, and the decision date is before the end of today, or there is no decision date and the offer is older than the decision-due threshold (default 3 days) |
| Consults this week | a consult not held and without an outcome, from the start of today for 7 days |
| No-decision review | lost with a `no_decision` reason and not reviewed (`lost_reviewed_at` null) |
| Nurture review | tagged `nurture-review` (by the Lost rule for Price or Timing) and not reviewed |

The sidebar counts use one aggregated query (`viewCounts`) with the same definitions; a test checks each count
equals its list's total.

## Today (`src/lib/today.ts`)

Overdue = due before the start of today (Cairo); due today = during today. "Reply" tasks are shown in the
response queue, not in these lists. Up to 50 rows per section; the badge is always the true total.

## Performance

At 10,000 leads every screen's queries run well under 1 second (`tests/perf.integration.test.ts` prints the
timings): for example the sidebar counts about 65 ms, Today about 90 ms, a smart view 25-150 ms.

## Finance (`src/lib/finance.ts`)

Rules from the Notion *Finances* page. Every figure reads the ledger (`ledger_entries`, soft-deleted rows excluded).

| Figure | Definition |
| --- | --- |
| Month of a row | the Cairo month of its date; a row without a date counts in the month it was added |
| Received | income rows with status Received, except refunds |
| Refunds | income rows in category Refund with status Received |
| Net income | received − refunds; this is what is split |
| Partner share | net × the partner's % (Settings > Finance split; default Badr 30, Sayyed 20, Retro 15, Mo 15) |
| Capital | net × Capital % (default 20) |
| Costs | fixed + variable cost rows with status Paid |
| Capital left | Capital − costs. On the Overview card: all months up to the end of the month shown |
| Withdrawn | partner-withdrawal rows with status Paid for that partner |
| Partner balance | all shares up to the end of the month shown − all withdrawals up to then |
| Coming up | rows still Expected (income) or Owed (costs, withdrawals), oldest first |
| Candidate due | price − discount (0 for a free seat; for a dropped student, no more than they paid net of refunds, so nothing remains) |
| Candidate paid | that candidate's Received payments − refunds |
| Candidate expected | that candidate's Expected payments |
| Remaining | due − paid (never below 0); overdue when an Expected payment's date has passed |

## Command centre (`src/lib/command.ts`) and targets (`src/lib/targets.ts`)

| Number | Definition |
| --- | --- |
| Pulse | The 7 days up to now against the 7 days before them (rolling, not calendar weeks) |
| New leads | Live leads created in the window (merged-away leads excluded) |
| Consults held | Consults marked held whose scheduled time falls in the window |
| Enrolments | Enrolments created in the window |
| Cash collected | Income ledger rows with status Received, dated in the window, less refunds |
| Tasks done | Tasks finished in the window |
| Revenue (targets) | What the window's new students owe: price less discount; free seats 0; dropped students what they paid |
| Quarter | Cairo calendar quarter (Q4 = 1 October 00:00 to 1 January 00:00, Cairo time) |
| Expected by now | Target × share of the quarter that has passed |
| On track / at risk / behind | Actual ≥ expected / ≥ 80% of expected / below that; reached = actual ≥ target; missed = quarter over and short |
| Leads past the red time | Open leads never contacted, created more than the red threshold ago (working hours not applied) |
| Overdue instalments | Expected income rows dated before today, excluding dropped students |
| Batch planner | Consults = seats ÷ consult-to-enrolment rate; leads = consults ÷ lead-to-consult rate; per week = total ÷ weeks left (at least 1 week) |
| Planner defaults | Last 180 days: share of new leads with a held consult; share of those that enrolled; average price after discount excluding free seats. Below 30 leads: 20% and 40%, and the average list price |

## Growth (`src/lib/campaigns.ts`, `events.ts`, `content.ts`, `referrals.ts`)

| Number | Definition |
| --- | --- |
| Campaign leads | Live leads whose campaign is this one |
| Held a consult | Of those, leads with at least one consult marked held |
| Enrolled | Of those, leads with an enrolment |
| Spend / owed | Ledger costs tagged to the campaign with status Paid / Owed |
| Cost per lead / per enrolment | Spend ÷ leads / spend ÷ enrolled (blank without spend) |
| Revenue from its students | What its enrolled leads owe (same rule as revenue: dropped students what they paid) |
| Return on spend | (revenue − spend) ÷ spend |
| Registered (masterclass) | Leads tagged to the campaign, plus its form sign-ups, plus anyone registered by hand |
| Show-up | Came ÷ (came + did not come); people not marked are left out |
| Consult after | Of those who came, leads with a held consult on or after the event date |
| Leads from a content piece | Live leads whose link carried the piece's tag as utm_content |
| Referred / enrolled (referrals) | Live leads whose referrer is this person / of those, with an enrolment |
| Campaign ROI tool | Leads = spend ÷ cost per lead, then × rates, each rounded down to whole people; break-even cost per lead = lead-to-consult × consult-to-enrolment × average price |

## Programme (`src/lib/classes.ts`, `assignments.ts`, `graduation.ts`)

| Number | Definition |
| --- | --- |
| Attendance rate | (present + late) ÷ (present + late + absent) over the batch's marked classes; excused not counted; blank when nothing was marked |
| Missed-class check-in | Made at the 2nd unexcused absence in a batch, once per student and batch |
| Submission result | Sum of criterion scores ÷ sum of criterion maximums, rounded to a whole %; Passed when ≥ the assignment's pass mark, else Needs rework |
| QC score | Rounded average of the student's reviewed results (latest attempt of each assignment) |
| Leaderboard rank | Rank by QC score within the batch, highest first, ties share a rank (1, 1, 3); dropped students and those without a reviewed result are not ranked |
| Ready to graduate | Not dropped, and every rule of the batch met: attendance ≥ the minimum (when any class was marked), every assignment passed (if required), nothing left to pay (if required) |
| Waiting for review (Command centre) | Submissions with status Waiting for review |
| Unmarked classes (Command centre) | Classes that started in the last 7 days with no attendance marked |

## Production, invoices and money (`src/lib/production.ts`, `invoices.ts`, `money.ts`, `production-quote.ts`)

| Number | Definition |
| --- | --- |
| Case price | units × unit price; × (1 + rush surcharge) when rushed; × (1 − client discount); rounded to whole EGP at each step |
| Due date | the given number of working days (Saturday–Thursday) after the day received, at 18:00 Cairo time |
| Late (case) | open and past its due time, or delivered after it |
| First-time QC pass rate | delivered cases with no QC fail ÷ delivered cases (last 90 days) |
| On time | delivered cases delivered by their due time ÷ delivered cases |
| Average turnaround | mean of delivered − received, in days |
| Designer pay earned | sum of designer pay on cases delivered in the period |
| Invoice owed / paid | its Expected / Received client-work ledger rows |
| Invoice overdue | issued, something still owed, past its due date (issue day + the client's payment terms) |
| Client owes | the Expected rows of their issued invoices |
| Budget used | paid + owed costs dated in the month ÷ the month's budget for the category |
| Over budget / unplanned | paid + owed above a budget / spent in a category with no budget |
| Forecast in / out | Expected income / Owed costs, withdrawals and refunds, dated in the week (dropped students' instalments left out) |
| Forecast budget still to spend | per month, budget − paid − owed (if positive), spread evenly over the month's days from today |
| Late (forecast) | Expected or Owed rows dated before today, shown apart |
| Batch revenue / margin | what its students owe (same rule as revenue) / revenue − costs tagged to the batch (paid and owed) |
| Marketing spend | paid costs in Ads & promotion or Referral rewards, or tagged to a campaign, dated in the period |
| Cost per lead / per enrolment | marketing spend ÷ leads created / enrolments made in the period |
| Revenue per enrolment | the price after discount of enrolments made in the period (free seats as 0) ÷ their number |
| Case type margin | revenue − designer pay of its cases delivered in the period |
| Pricing scenario | seats = cap × fill; paying = seats − free; revenue = paying × price after discount; costs = batch costs + seats × cost per student; break-even = ⌈(batch costs + free seats × cost per student) ÷ (price after discount − cost per student)⌉ paying students |
| Cases delivered (pulse) | cases with a delivery time in the last 7 days (and the 7 before) |
