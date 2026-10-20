/**
 * Author review window helpers. The database is the source of truth
 * (validate_blog_post_schedule); these only pre-compute the UI defaults.
 * Storage is UTC; authors see and pick times in Europe/Rome.
 */
export const REVIEW_WINDOW_HOURS = 24;
const SLOT_MS = 30 * 60 * 1000;
const TZ = "Europe/Rome";

/** First 30-minute slot at or after `now + 24h`. Italy has whole-hour offsets, so UTC slots match local ones. */
export function firstReviewSlot(now: Date = new Date()): Date {
  const min = now.getTime() + REVIEW_WINDOW_HOURS * 3600 * 1000;
  return new Date(Math.ceil(min / SLOT_MS) * SLOT_MS);
}

export function isValidReviewDate(scheduled: Date, submittedAt: Date = new Date()): boolean {
  return (
    scheduled.getTime() >= submittedAt.getTime() + REVIEW_WINDOW_HOURS * 3600 * 1000 &&
    scheduled.getTime() % SLOT_MS === 0
  );
}

/** Date → { date: "YYYY-MM-DD", time: "HH:MM" } in Italian time. */
export function romeParts(d: Date): { date: string; time: string } {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

function romeOffsetMinutes(d: Date): number {
  const { date, time } = romeParts(d);
  const [y, mo, da] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const asUtc = Date.UTC(y, mo - 1, da, h, mi);
  return Math.round((asUtc - Math.floor(d.getTime() / 60000) * 60000) / 60000);
}

/** Italian wall-clock date + time → absolute Date (UTC instant). */
export function romeToDate(date: string, time: string): Date {
  const [y, mo, da] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const guess = Date.UTC(y, mo - 1, da, h, mi);
  const off = romeOffsetMinutes(new Date(guess));
  let t = guess - off * 60000;
  const off2 = romeOffsetMinutes(new Date(t));
  if (off2 !== off) t = guess - off2 * 60000;
  return new Date(t);
}
