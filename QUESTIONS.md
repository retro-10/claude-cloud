# Open questions

Each has a safe default already applied. Answer any and it will be changed.

1. ~~Financial admin role, admin = owner, emails~~ **Answered.** Sayed is `owner`. Mo (`finance`) may see revenue and enrolments, record and edit payments, and export revenue, but not edit leads or settings; wired up in Phase 6/7 when those screens exist. Emails stay on the local host: `sayed@orladent.local`, `mo@orladent.local`.
2. **Lost reasons on day one.** Default list: Price, Timing, No response, Not a fit, Chose competitor, Hardware, Other.
3. **Stage names.** Default labels: New, Contacted, Replied, Consult booked, Consult held, Offer sent, Enrolled, Lost, Nurture.
4. **Next cohort.** Dates and seat cap not provided; the seed will use a placeholder cohort clearly named "Demo cohort" in Phase 6.
5. **Tier prices.** Foundation 7,500, Freelance Ready 15,000 EGP; Production Partner is custom. Default: the enrolment form pre-fills the list price for the first two and leaves Production Partner blank.
6. **Currency and phone.** Numbers without a country code are assumed Egyptian (+20). A local number like `010…` becomes `+2010…`. Other countries need an explicit `+`.
7. **Objection tag "Other" and lost reason "Other"** both exist. Fine, or merge?
8. **Auto-advance stage on first contact?** Now: logging the first outbound WhatsApp does not move `new` to `contacted`; the stage is moved by hand. Should it move automatically? (Default: no.)
9. **Bulk actions** (change stage, assign owner, add to cadence) from 4.1 are not in Phase 2's scope table; planned with the pipeline (Phase 4) and cadences (Phase 5). Say if you want them sooner.
10. ~~Cancelling an enrolment / refunds~~ **Answered: Dropped stops the balance.** A dropped student owes nothing more, their Expected installments are cancelled, and revenue counts only what they paid net of refunds. Was: **Cancelling an enrolment / refunds.** A refund is now a ledger row (Income > Refund) and a student can be marked Dropped, but a dropped student still counts as owing their price. Should Dropped stop the balance (and remove them from revenue)?
11. **Date format in imports.** `05/09/2026` is read as 5 September (day first). Is your ClickUp export month-first? (Default: day-first; ISO dates and ClickUp epoch timestamps are unambiguous.)
12. **Over-cap override** is owner-only (Retro, Badr). OK, or should sales be allowed too?
13. **Demo cohort.** The seed adds a placeholder "Demo cohort" (now 40 seats, the camp cap). Replace it with the real next intake (dates, seat cap) in Phase 6.
14. **Reply stops the post-consult cadence too.** The brief's stop rule cancels any open cadence follow-ups on an inbound reply, which includes the post-consult sequence (a reply to your voice-note recap would cancel the day-2/5/7 messages). Done as written. Should the post-consult cadence be exempt?
15. **Follow-up time of day.** Cadence and date-only follow-ups are due 09:00 Cairo. Change?
16. ~~Who may export the lead list?~~ **Answered: owners only.** Was: Any signed-in user who can read leads (including viewer and finance) can currently download the lead CSV (names, phones, emails). Revenue exports are owner/finance only. Should the lead export be restricted to owners?
17. ~~Who may see revenue?~~ **Answered: owner and finance only** (dashboard, batches, a lead's payments). Was: Currently everyone signed in. Restrict to owner and finance?
18. **Consults move the stage automatically** (booked, held), forward only. Fine, or should the stage only change by hand?
19. **"Within 5 minutes" denominator.** It counts all leads in the selection, so uncontacted leads pull the percentage down (8 of 20 = 40% on the demo data). The alternative is contacted leads only (8 of 18 = 44%). Which do you want on the dashboard?
20. **Cohort filter meaning.** Choosing a cohort shows the journey of the leads that enrolled in it (so the funnel ends at 100%). Is that what you want, or should it filter by something else (for example leads created during that cohort's sales window)?
21. **Show-up rate** ignores consults that are still to happen or awaiting a result. OK?
22. **Self-host the fonts?** Inter and Playfair Display currently load from Google Fonts (non-blocking, with fallbacks). Self-hosting removes the only third-party request and works offline; it needs the font files added to the repo. Do you want that?
23. **Session length.** Sessions last 7 days and end sooner if the password changes or the user is deactivated. Shorter (for example 12 hours)?
24. ~~Two-factor sign-in~~ **Answered: built** (authenticator app, optional per person, owners and finance reminded). Was: is not built. With customers' personal data on the public internet, do you want it added?
25. **Data retention.** Nothing is ever purged. Do you need a rule (for example anonymise leads inactive for N months) for privacy?

## Release 1.1 (feature blueprint)

26. **Working hours.** The response-time clock can skip nights and days off, but the blueprint gives no hours, so it is **off**. If you want it, what are Camp's hours and days (the placeholder is 10:00-22:00, Friday off)?
27. ~~Default owner~~ **Answered: Retro by default** (seeded once; changeable in Settings > Thresholds & routing). Was: The blueprint says new leads belong to Retro by default. Today a lead belongs to whoever adds it until you pick a default owner in Settings > Thresholds & routing. Set Retro as the default?
28. **Message templates.** Only neutral starter templates are seeded (no prices, incentives, guarantees or outcome claims). The blueprint asks for the objection replies and cadence wording from the Camp sales roadmap: please share it, and Badr must approve any price, incentive or claim before it goes in.
29. **Referral-ask template** was not seeded because the reward rules are Badr's to set (blueprint E5).
30. **Consult held checks.** Entering Consult held needs at least one objection tag. If a consult raises no objection, the owner overrides with a reason. Add an objection called "None raised" instead?
31. **Exact-email duplicates.** The blueprint's table says "block and offer merge" while its note says "auto-merge exact email". Built: block and offer the existing lead, merge only by a person (merges are hard to undo). OK?
32. **Merged-away stage history** stays on the merged-away lead (hidden), so the funnel does not count one person twice. The combined timeline shows every activity, follow-up and consult. OK?
33. **"No response" vs "No decision".** Both lost reasons exist: No response = never replied; No decision = went silent after the offer (reported separately on the dashboard). Keep both?
34. **Course prerequisites** (computer, Exocad access) for the fit scoring in Release 1.2: what exactly should count?
35. **Consent wording.** The CRM records how each lead agreed to WhatsApp contact. Is there wording you want on forms, and has a lawyer confirmed the obligations under Law 151 of 2020?

## Finance and Notion

36. **Changing the split.** The split is one rule applied to every month, so changing it recomputes past
    months too. If a new split should only apply from a date on, say so and the setting will carry a start date.
37. **Paying more than is due.** A payment larger than the remaining balance is accepted (it shows as fully
    paid). Refuse it instead, or record the extra as client work?
38. **Who sees a candidate's payments?** The Payments card on a lead's page (due, paid, installments) is shown
    to everyone who can open the lead, so sales can chase installments; recording money is owner/finance
    only. Hide the amounts from sales and viewers?
39. **Leads in Notion.** Answered: yes, `NOTION_SYNC_LEADS=true` (set in `.env.example`).
40. **Candidates added in Notion.** One with a Batch and a Tier becomes an enrolled lead in the CRM (source
    "Notion"), skipping the pipeline's checks. OK, or should they arrive as leads to be worked first?
41. **Notion-only columns.** Answered: bring all of them in. Consent on file, consent scope, QC score and leaderboard rank sync both ways; Sessions and the Proof & Testimonial Bank sync both ways; Team comes in read-only (no pay or equity). See DECISIONS.md.
42. **Fonts.** Now Inter and Noto Sans Arabic (clean and readable, as asked), from Google Fonts (see #22 about self-hosting).
43. **Team from the CRM.** Answered: yes. Owners add and edit team members in Settings > Team and it syncs to
    Notion. Pay columns turned out not to be needed: the sync writes only the columns it knows, so salary and
    equity stay in Notion untouched.
44. **Proof "Used in content".** The Proof bank's link to the Content pieces database is not synced (the CRM has
    no content calendar). Needed?

## OrlaDent OS, Phase 1

34. **Require two-factor?** It is optional for everyone, with a standing reminder for owners and finance. Should
    it be required for owners and finance (they could not use the app until it is on)?
35. **Work week.** The weekly review runs Monday to Sunday. Camp's week may start on Saturday or Sunday; which do
    you want?
36. **Targets.** Only quarterly targets for five numbers exist (leads, consults held, enrolments, revenue, cash).
    Do you want monthly targets, or targets per batch or per salesperson?
37. **Files.** 8 MB each, kept in the database. If you will store many case files or videos, we should move them
    to object storage (a small monthly cost). How much do you expect?
38. **Who may delete files?** Now: whoever added it, or an owner. Fine?

## OrlaDent OS, Phase 2

39. **WhatsApp sending.** Reminders and follow-ups open WhatsApp with the text filled in, and a person presses
    send. Sending automatically needs the WhatsApp Business API (a Meta business account, approved templates, a
    cost per conversation). Do you want that?
40. **Meta lead ads.** The webhook is ready for Zapier or Make. Do you already use one of them, or should we
    connect Meta directly (needs a Meta app and its review)?
41. **Reward rules.** Referral rewards are decided one by one. Once Badr sets the rule (for example a fixed
    amount per enrolled referral, or a discount for the referrer), it can be pre-filled.
42. **Public form wording.** The Arabic labels and the consent sentence are a first draft. Please check them,
    and whether a privacy notice link is needed (Law 151 of 2020).

## OrlaDent OS, Phase 3

45. **Missed classes.** A check-in task is made at the second unexcused absence in a batch. Is two right, and
    should the student also get a WhatsApp message (written by a person, as now)?
46. **Graduation rules.** Each batch starts at 75% attendance and every assignment passed; paid in full is off.
    Are those the camp's rules? Should an unpaid student be able to graduate?
47. **Certificate wording.** It says "This certifies that … has completed the Foundation programme of OrlaDent
    Camp (batch)". Please confirm the wording, whether it should be signed (and by whom), and whether you want an
    Arabic version.
48. **Portal languages.** Headings in the portal are in English with Arabic beside them. Do you want a full
    Arabic version?
49. **What instructors see.** Instructors can read every lead (not only their students) so they can open a
    student's page. Should they see only enrolled students?
50. **Alumni for hire.** The alumni directory is staff-only. Do you want a public page of graduates open to work
    (each graduate opting in)?

## OrlaDent OS, Phase 4

51. **Production scope.** The studio assumes OrlaDent sells design work to clinics and labs (the plan's open
    question). If it does not, it can be hidden from the menu. Who runs it day to day: an owner, or someone
    who should get its own role?
52. **The price list.** None is filled in: please give each kind of case, its price per unit, the designer's pay
    per unit, the turnaround (standard and rush) and the rush surcharge.
53. **Working days.** Turnaround skips Fridays only. Are Saturdays off too, and should public holidays count?
54. **Who checks QC.** Now: owners, and never the case's own designer. Should a senior designer be able to QC
    other designers' cases?
55. **Invoice details.** Business name, address, tax registration number and how clients pay are empty
    (Settings > Finance). Do invoices need VAT (14%) or an e-invoice through the Tax Authority's system?
56. **Payment gateway.** Paid links need Paymob, Fawry or another provider (an account and fees). Which one,
    and for students, clients or both?
57. **Designer pay.** Each delivered case books the designer's pay as owed. Are designers paid per case,
    monthly, or both, and through which method?
58. **Budgets.** Who sets the monthly budget, and should it be per batch as well as per month?

## OrlaDent OS, Phase 5

59. **Switching it on.** The assistant sends the business data it looks up (never phone numbers or emails) to
    Anthropic. Under Anthropic's commercial terms that data is not used to train its models. Are you happy to
    switch it on? Who holds the Anthropic account and pays for it?
60. **Money in answers.** Money is off by default. Should Ask OrlaDent answer money questions for owners and
    finance?
61. **Brand voice.** The default voice is a guess (warm, direct, Egyptian audience, no hype). Please rewrite it
    in your own words, with one or two real messages you liked.
62. **Daily limit and budget.** 100 requests per person per day. What monthly spend is fine before someone is
    told? (A typical question costs a few US cents.)
63. **Drop-risk rules.** The early warning adds points for low attendance, missed classes, overdue work, stale
    rework and an overdue instalment. Do these match how students actually drop? Should an instructor be told
    when someone crosses into "at risk"?
64. **Prices in drafts.** Drafts never state a price unless it is in the app (an offer on the lead). Should the
    tier prices be given to the assistant so it can answer "how much is it?"

