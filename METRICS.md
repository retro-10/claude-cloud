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
| Revenue / collected | sum of enrolment amounts / of those with a paid date |
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
