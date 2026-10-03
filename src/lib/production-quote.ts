import { addDaysYmd, cairoLocalToDate } from "./time";

// Pure (no database): the turnaround quote tool runs it in the browser, case intake on the server.

/** The studio's working week: every day but Friday. */
export const isWorkingDay = (ymd: string) => new Date(`${ymd}T12:00:00Z`).getUTCDay() !== 5;

/** `n` working days after `ymd` (the day itself does not count). */
export function addWorkingDays(ymd: string, n: number): string {
  let d = ymd;
  for (let left = Math.max(0, Math.floor(n)); left > 0; ) {
    d = addDaysYmd(d, 1);
    if (isWorkingDay(d)) left--;
  }
  return d;
}

/** Cases are due by 18:00 Cairo time on their due day. */
export const DUE_HOUR = "18:00";
export const dueAtFor = (ymd: string) => cairoLocalToDate(`${ymd}T${DUE_HOUR}`)!;

export type QuoteInput = {
  unitPriceEgp: number;
  units: number;
  discountPct: number; // the client's agreed discount
  rush: boolean;
  rushSurchargePct: number;
  standardDays: number;
  rushDays: number;
  receivedYmd: string; // Cairo date
};

/**
 * Price = units × unit price, plus the rush surcharge when rushed, minus the client's discount; whole EGP at each
 * step. Due = that many working days after the day it was received, at 18:00.
 */
export function quote(q: QuoteInput): { priceEgp: number; listEgp: number; surchargeEgp: number; discountEgp: number; days: number; dueYmd: string } {
  const units = Math.max(1, Math.floor(q.units));
  const listEgp = q.unitPriceEgp * units;
  const rushed = q.rush ? Math.round((listEgp * (100 + q.rushSurchargePct)) / 100) : listEgp;
  const priceEgp = Math.round((rushed * (100 - q.discountPct)) / 100);
  const days = q.rush ? q.rushDays : q.standardDays;
  return { priceEgp, listEgp, surchargeEgp: rushed - listEgp, discountEgp: rushed - priceEgp, days, dueYmd: addWorkingDays(q.receivedYmd, days) };
}
