import { describe, expect, it } from "vitest";
import { addMonthsYmd, buildOffer, campaignRoi, offerMessage, planBatch, pricingScenario, type OfferInput } from "@/lib/tools";

describe("offer builder", () => {
  const base: OfferInput = { tier: "freelance_ready", priceEgp: 15000, discountEgp: 1000, plan: "installments", depositEgp: 4000, instalments: 3, firstDue: "2026-10-31" };

  it("month steps keep the day, or the month's last day", () => {
    expect(addMonthsYmd("2026-10-31", 1)).toBe("2026-11-30");
    expect(addMonthsYmd("2026-12-15", 2)).toBe("2027-02-15");
    expect(addMonthsYmd("2027-01-31", 1)).toBe("2027-02-28");
    expect(addMonthsYmd("2028-01-31", 1)).toBe("2028-02-29");
  });

  it("splits the rest into equal parts rounded to 50 EGP, the last one taking the remainder", () => {
    const r = buildOffer(base);
    expect(r).toEqual({
      ok: true,
      total: 14000,
      schedule: [
        { due: null, amount: 4000, label: "Deposit now" },
        { due: "2026-10-31", amount: 3300, label: "Instalment 1 of 3" },
        { due: "2026-11-30", amount: 3300, label: "Instalment 2 of 3" },
        { due: "2026-12-31", amount: 3400, label: "Instalment 3 of 3" },
      ],
    });
    if (r.ok) expect(r.schedule.reduce((a, s) => a + s.amount, 0)).toBe(14000);
  });

  it("one-time is a single payment; bad input is refused with a reason", () => {
    expect(buildOffer({ ...base, plan: "one_time" })).toMatchObject({ ok: true, total: 14000, schedule: [{ amount: 14000 }] });
    expect(buildOffer({ ...base, discountEgp: 15000 })).toEqual({ ok: false, error: "The discount must be less than the price" });
    expect(buildOffer({ ...base, depositEgp: 14000 })).toEqual({ ok: false, error: "The deposit must be less than the total" });
    expect(buildOffer({ ...base, instalments: 9 })).toEqual({ ok: false, error: "Choose 1 to 6 instalments" });
  });

  it("writes a factual message with the schedule, link and decision date", () => {
    const o = { ...base, depositEgp: 2000, instalments: 2 };
    const r = buildOffer(o);
    if (!r.ok) throw new Error(r.error);
    expect(offerMessage(o, r, { firstName: "Hana", tierLabel: "Freelance Ready", paymentLink: "https://pay.example/x", decisionBy: "2026-10-20" })).toBe(
      [
        "Hi Hana, here is your OrlaDent Camp offer:",
        "• Programme: Freelance Ready",
        "• Price: 14,000 EGP (15,000 less 1,000 discount)",
        "• Payment: 2,000 EGP now, then 2 instalments of 6,000 EGP on 31 Oct 2026, 30 Nov 2026",
        "• Payment link: https://pay.example/x",
        "Could you let me know by 20 Oct 2026?",
        "Any questions, just reply here.",
      ].join("\n"),
    );
  });
});

describe("batch planner", () => {
  it("works back from seats to consults to leads, per week", () => {
    expect(planBatch({ seatsToFill: 20, avgPriceEgp: 11250, leadToConsult: 0.25, consultToEnrol: 0.5, weeksLeft: 4 })).toEqual({
      ok: true,
      consults: 40,
      leads: 160,
      consultsPerWeek: 10,
      leadsPerWeek: 40,
      revenueEgp: 225000,
    });
  });
  it("with under a week left, the weekly figure is the whole amount, never more", () => {
    expect(planBatch({ seatsToFill: 8, avgPriceEgp: 12000, leadToConsult: 0.2, consultToEnrol: 0.4, weeksLeft: 3 / 7 })).toMatchObject({ leads: 100, leadsPerWeek: 100, consults: 20, consultsPerWeek: 20 });
  });
  it("refuses impossible inputs", () => {
    expect(planBatch({ seatsToFill: 5, avgPriceEgp: 1, leadToConsult: 0, consultToEnrol: 0.5, weeksLeft: 2 }).ok).toBe(false);
    expect(planBatch({ seatsToFill: 5, avgPriceEgp: 1, leadToConsult: 0.2, consultToEnrol: 0.5, weeksLeft: 0 })).toEqual({ ok: false, error: "The enrolment close date has passed: pick a later one" });
  });
});

describe("campaign ROI", () => {
  it("whole people only: leads, consults and enrolments are rounded down; break-even is revenue per lead", () => {
    expect(campaignRoi({ spendEgp: 20000, costPerLead: 150, leadToConsult: 0.25, consultToEnrol: 0.4, avgPriceEgp: 11250 })).toEqual({
      ok: true,
      leads: 133,
      consults: 33,
      enrolments: 13,
      revenueEgp: 146250,
      costPerEnrolment: 1538,
      roi: (146250 - 20000) / 20000,
      breakEvenCostPerLead: 1125,
    });
  });
  it("too little spend for one enrolment shows no cost per enrolment and a loss", () => {
    expect(campaignRoi({ spendEgp: 500, costPerLead: 200, leadToConsult: 0.2, consultToEnrol: 0.4, avgPriceEgp: 7500 })).toMatchObject({ enrolments: 0, costPerEnrolment: null, roi: -1 });
    expect(campaignRoi({ spendEgp: 0, costPerLead: 1, leadToConsult: 0.2, consultToEnrol: 0.4, avgPriceEgp: 1 }).ok).toBe(false);
  });
});

describe("pricing scenario and break-even", () => {
  const base = { listPriceEgp: 7500, discountPct: 10, seatCap: 40, fillPct: 75, freeSeats: 2, fixedCostsEgp: 60000, variablePerStudentEgp: 500 };
  it("revenue from paying seats, costs for every seat, margin and break-even", () => {
    const r = pricingScenario(base);
    if (!r.ok) throw new Error(r.error);
    // 30 seats, 28 paying at 6,750 = 189,000; costs 60,000 + 30 × 500 = 75,000
    expect(r).toMatchObject({ seats: 30, paying: 28, netPriceEgp: 6750, revenueEgp: 189000, costsEgp: 75000, marginEgp: 114000 });
    // (60,000 + 2 × 500) / (6,750 − 500) = 9.76 → 10 paying students
    expect(r.breakEvenPaying).toBe(10);
    expect(r.fullMarginEgp).toBe(38 * 6750 - (60000 + 40 * 500));
  });
  it("never breaks even when a student costs more than they pay; checks the inputs", () => {
    const r = pricingScenario({ ...base, listPriceEgp: 400, discountPct: 0 });
    expect(r.ok && r.breakEvenPaying).toBeNull();
    expect(pricingScenario({ ...base, freeSeats: 41 })).toMatchObject({ ok: false });
    expect(pricingScenario({ ...base, fillPct: 120 })).toMatchObject({ ok: false });
  });
});
