import { describe, expect, it } from "vitest";
import { templateProblem } from "@/lib/message-templates";
import { normalizePhone, phoneProblem } from "@/lib/phone";
import { foldArabic, phoneDigits } from "@/lib/search";
import { stageNameProblem } from "@/lib/settings";
import { speedLevel, waitingMinutes } from "@/lib/speed";
import { renderTemplate, unfilled, whatsappPrefill } from "@/lib/templates-render";
import { cairoLocalToDate } from "@/lib/time";

describe("D1: Egyptian numbers normalise to one E.164 value", () => {
  const twelve = [
    "01001234567",
    "0100 123 4567",
    "0100-123-4567",
    "(0100) 123 4567",
    "+20 100 123 4567",
    "+201001234567",
    "+20 (0) 100 123 4567",
    "00201001234567",
    "0020 100 123 4567",
    "1001234567",
    "٠١٠٠١٢٣٤٥٦٧",
    "+2001001234567",
  ];
  it.each(twelve)("%s", (raw) => expect(normalizePhone(raw)).toBe("+201001234567"));

  it("rejects clearly invalid Egyptian numbers with a fixable message", () => {
    for (const bad of ["0131234567", "01312345678", "0100123", "+20 100 123 45678"]) {
      expect(normalizePhone(bad), bad).toBeNull();
      expect(phoneProblem(bad)).toMatch(/Egyptian mobiles|too short/);
    }
    expect(normalizePhone("+44 7700 900123")).toBe("+447700900123"); // other countries still work
    expect(normalizePhone("02 2345 6789")).toBe("+20223456789"); // Cairo landline
  });
});

describe("V2: search ignores phone formatting and Arabic spelling variants", () => {
  it("phone digits drop spaces, dashes and the trunk prefix", () => {
    expect(phoneDigits("0100 777-66")).toBe("10077766");
    expect(phoneDigits("+20 100 777 66")).toBe("2010077766");
    expect(phoneDigits("0020100")).toBe("20100");
    expect(phoneDigits("ab")).toBeNull();
  });
  it("folds alef, yeh and teh marbuta forms", () => {
    expect(foldArabic("أحمد")).toBe(foldArabic("احمد"));
    expect(foldArabic("فاطمة")).toBe(foldArabic("فاطمه"));
    expect(foldArabic("مصطفى")).toBe(foldArabic("مصطفي"));
    expect(foldArabic("Nour")).toBe("nour");
  });
});

describe("C3: response time with working hours", () => {
  const at = (s: string) => cairoLocalToDate(s)!;
  const wh = { enabled: true, start: "10:00", end: "22:00", days: [0, 1, 2, 3, 4, 6] }; // Friday off

  it("counts plain minutes when working hours are off", () => {
    expect(waitingMinutes(at("2026-09-28T09:00"), at("2026-09-28T09:45"))).toBe(45);
  });
  it("does not count the night", () => {
    // arrives 23:00 Monday, clock starts 10:00 Tuesday: at 10:07 it has waited 7 minutes
    expect(waitingMinutes(at("2026-09-28T23:00"), at("2026-09-29T10:07"), wh)).toBe(7);
  });
  it("does not count a day off", () => {
    // Thursday 21:50 -> Saturday 10:05: 10 minutes Thursday, Friday off, 5 minutes Saturday
    expect(waitingMinutes(at("2026-10-01T21:50"), at("2026-10-03T10:05"), wh)).toBe(15);
  });
  it("thresholds decide the colour", () => {
    const t = { slaAmberMin: 5, slaRedMin: 30 };
    expect([4, 5, 29, 30].map((m) => speedLevel(m, t))).toEqual(["ok", "amber", "amber", "red"]);
    expect(speedLevel(10, { slaAmberMin: 15, slaRedMin: 60 })).toBe("ok"); // changing the threshold changes the colour
  });
});

describe("M1/M2: templates", () => {
  it("fills placeholders and keeps missing ones visible", () => {
    const r = renderTemplate("Hi {first_name}, pay here: {payment_link}", { first_name: "Nour" });
    expect(r.text).toBe("Hi Nour, pay here: {payment_link}");
    expect(r.missing).toEqual(["payment_link"]);
    expect(unfilled(r.text)).toEqual(["payment_link"]);
  });
  it("Arabic text round-trips into a wa.me link", () => {
    const url = whatsappPrefill("+201001234567", "أهلاً نور")!;
    expect(url.startsWith("https://wa.me/201001234567?text=")).toBe(true);
    expect(decodeURIComponent(url.split("text=")[1])).toBe("أهلاً نور");
  });
  it("E2: a template cannot contain a typed deadline or an unknown placeholder", () => {
    const base = { name: "x", category: "deadline_notice", language: "en" };
    expect(templateProblem({ ...base, body: "Closes on 12/10" })).toMatch(/Don't type dates/);
    expect(templateProblem({ ...base, body: "Closes 12 October" })).toMatch(/Don't type dates/);
    expect(templateProblem({ ...base, language: "ar", body: "الحجز يقفل ١٢ أكتوبر" })).toMatch(/Don't type dates/);
    expect(templateProblem({ ...base, body: "Closes {deadline}" })).toMatch(/Unknown placeholder/);
    expect(templateProblem({ ...base, body: "Enrolment closes on {cohort_close_date}." })).toBeNull();
  });
});

describe("P2: stage names describe a state, not a time", () => {
  it("rejects time buckets", () => {
    for (const n of ["Q4 deals", "This week", "October leads", "2026 pipeline"]) expect(stageNameProblem(n), n).toMatch(/not a time period/);
    expect(stageNameProblem("Waiting for payment")).toBeNull();
  });
});
