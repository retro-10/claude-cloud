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
