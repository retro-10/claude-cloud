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
10. **Cancelling an enrolment / refunds.** Enrolled leads cannot currently be moved back or un-enrolled. Do you need a cancel/refund flow? (Default: no, until asked; it must also update revenue.)
11. **Date format in imports.** `05/09/2026` is read as 5 September (day first). Is your ClickUp export month-first? (Default: day-first; ISO dates and ClickUp epoch timestamps are unambiguous.)
12. **Over-cap override** is owner-only (Retro, Badr). OK, or should sales be allowed too?
13. **Demo cohort.** The seed adds a placeholder "Demo cohort" (30 seats). Replace it with the real next intake (dates, seat cap) in Phase 6.
14. **Reply stops the post-consult cadence too.** The brief's stop rule cancels any open cadence follow-ups on an inbound reply, which includes the post-consult sequence (a reply to your voice-note recap would cancel the day-2/5/7 messages). Done as written. Should the post-consult cadence be exempt?
15. **Follow-up time of day.** Cadence and date-only follow-ups are due 09:00 Cairo. Change?
16. **Who may export the lead list?** Any signed-in user who can read leads (including viewer and finance) can currently download the lead CSV (names, phones, emails). Revenue exports are owner/finance only. Should the lead export be restricted to owners?
17. **Who may see revenue?** Currently everyone signed in. Restrict to owner and finance?
18. **Consults move the stage automatically** (booked, held), forward only. Fine, or should the stage only change by hand?
19. **"Within 5 minutes" denominator.** It counts all leads in the selection, so uncontacted leads pull the percentage down (8 of 20 = 40% on the demo data). The alternative is contacted leads only (8 of 18 = 44%). Which do you want on the dashboard?
20. **Cohort filter meaning.** Choosing a cohort shows the journey of the leads that enrolled in it (so the funnel ends at 100%). Is that what you want, or should it filter by something else (for example leads created during that cohort's sales window)?
21. **Show-up rate** ignores consults that are still to happen or awaiting a result. OK?
22. **Self-host the fonts?** Inter and Playfair Display currently load from Google Fonts (non-blocking, with fallbacks). Self-hosting removes the only third-party request and works offline; it needs the font files added to the repo. Do you want that?
23. **Session length.** Sessions last 7 days and end sooner if the password changes or the user is deactivated. Shorter (for example 12 hours)?
24. **Two-factor sign-in** is not built. With customers' personal data on the public internet, do you want it added?
25. **Data retention.** Nothing is ever purged. Do you need a rule (for example anonymise leads inactive for N months) for privacy?

## Release 1.1 (feature blueprint)

26. **Working hours.** The response-time clock can skip nights and days off, but the blueprint gives no hours, so it is **off**. If you want it, what are Camp's hours and days (the placeholder is 10:00-22:00, Friday off)?
27. **Default owner.** The blueprint says new leads belong to Retro by default. Today a lead belongs to whoever adds it until you pick a default owner in Settings > Thresholds & routing. Set Retro as the default?
28. **Message templates.** Only neutral starter templates are seeded (no prices, incentives, guarantees or outcome claims). The blueprint asks for the objection replies and cadence wording from the Camp sales roadmap: please share it, and Badr must approve any price, incentive or claim before it goes in.
29. **Referral-ask template** was not seeded because the reward rules are Badr's to set (blueprint E5).
30. **Consult held checks.** Entering Consult held needs at least one objection tag. If a consult raises no objection, the owner overrides with a reason. Add an objection called "None raised" instead?
31. **Exact-email duplicates.** The blueprint's table says "block and offer merge" while its note says "auto-merge exact email". Built: block and offer the existing lead, merge only by a person (merges are hard to undo). OK?
32. **Merged-away stage history** stays on the merged-away lead (hidden), so the funnel does not count one person twice. The combined timeline shows every activity, follow-up and consult. OK?
33. **"No response" vs "No decision".** Both lost reasons exist: No response = never replied; No decision = went silent after the offer (reported separately on the dashboard). Keep both?
34. **Course prerequisites** (computer, Exocad access) for the fit scoring in Release 1.2: what exactly should count?
35. **Consent wording.** The CRM records how each lead agreed to WhatsApp contact. Is there wording you want on forms, and has a lawyer confirmed the obligations under Law 151 of 2020?
