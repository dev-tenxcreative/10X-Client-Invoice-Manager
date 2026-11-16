/*
 * Business dates are stored as "YYYY-MM-DD" strings in Asia/Colombo time, so comparisons
 * are plain string comparisons and never shift with server time zones.
 */

export const TIME_ZONE = "Asia/Colombo";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function isDateString(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Calendar date in Colombo for an instant. */
export function colomboDate(at: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function today(): string {
  return colomboDate(new Date());
}

export function addDays(date: string, days: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days from a to b (b - a). */
export function diffDays(a: string, b: string): number {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
}

/** 0 = Sunday … 6 = Saturday */
export function weekday(date: string): number {
  return new Date(date + "T00:00:00Z").getUTCDay();
}

/** "16 Nov 2026" */
export function formatDate(date?: string | null): string {
  if (!date) return "";
  const [y, m, d] = date.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** "16 Nov 2026, 08:00" in Colombo time */
export function formatDateTime(at?: Date | string | null): string {
  if (!at) return "";
  const d = typeof at === "string" ? new Date(at) : at;
  const date = formatDate(colomboDate(d));
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  return `${date}, ${time}`;
}

/** "2026-11" */
export function periodOf(date: string): string {
  return date.slice(0, 7);
}

/** "November 2026" */
export function periodLabel(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return `${MONTHS_LONG[m - 1]} ${y}`;
}

export function nextPeriod(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

/** Billing date for a period; billing day is limited to 1..28 so it exists in every month. */
export function billingDate(period: string, billingDay: number): string {
  return `${period}-${String(billingDay).padStart(2, "0")}`;
}

/** Start of the Colombo day as a UTC instant. */
export function colomboDayStart(date: string): Date {
  return new Date(date + "T00:00:00+05:30");
}
