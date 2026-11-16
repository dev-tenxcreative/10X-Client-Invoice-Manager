import type { Discount, LineItem, Tax, Totals } from "./types";

/*
 * Money is always an integer number of minor units (cents). Never floats.
 * Quantities are integers in hundredths (1.5 => 150). Rates are basis points (10% => 1000).
 */

export const CURRENCY_DECIMALS: Record<string, number> = { LKR: 2, USD: 2 };

/** Integer division of a BigInt with half-up rounding (for non-negative results). */
function divRoundHalfUp(n: bigint, d: bigint): bigint {
  if (d <= 0n) throw new Error("Divisor must be positive");
  const neg = n < 0n;
  const a = neg ? -n : n;
  const q = a / d;
  const r = a % d;
  const res = r * 2n >= d ? q + 1n : q;
  return neg ? -res : res;
}

function toSafeNumber(b: bigint): number {
  if (b > BigInt(Number.MAX_SAFE_INTEGER) || b < -BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Amount is too large");
  }
  return Number(b);
}

/** Parses a decimal string such as "65,000.50" into an integer with `decimals` places. */
export function parseDecimal(input: string | number, decimals: number): number {
  const s = String(input).trim().replace(/,/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error(`"${input}" is not a valid number`);
  const neg = s.startsWith("-");
  const [whole, frac = ""] = s.replace("-", "").split(".");
  if (frac.length > decimals) {
    // Round half up on the extra digits.
    const keep = frac.slice(0, decimals);
    const next = Number(frac[decimals]);
    let v = BigInt(whole + keep.padEnd(decimals, "0"));
    if (next >= 5) v += 1n;
    return toSafeNumber(neg ? -v : v);
  }
  const v = BigInt(whole + frac.padEnd(decimals, "0"));
  return toSafeNumber(neg ? -v : v);
}

export function toMinor(input: string | number, currency = "LKR"): number {
  return parseDecimal(input, CURRENCY_DECIMALS[currency] ?? 2);
}

export function parseQty(input: string | number): number {
  const q = parseDecimal(input, 2);
  if (q <= 0) throw new Error("Quantity must be more than zero");
  return q;
}

export function parseRateBp(input: string | number): number {
  const bp = parseDecimal(input, 2);
  if (bp < 0 || bp > 10000) throw new Error("Rate must be between 0 and 100");
  return bp;
}

/** Formats an integer with `decimals` places as "1,234.50" (no currency). */
export function formatDecimal(value: number, decimals = 2): string {
  const neg = value < 0;
  const s = Math.abs(value).toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, s.length - decimals);
  const frac = decimals > 0 ? "." + s.slice(s.length - decimals) : "";
  return (neg ? "-" : "") + whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + frac;
}

/** "LKR 65,000.00" */
export function formatMoney(minor: number, currency: string): string {
  return `${currency} ${formatDecimal(minor, CURRENCY_DECIMALS[currency] ?? 2)}`;
}

/** Plain value for form inputs: 6500000 -> "65000.00" */
export function minorToInput(minor: number, currency = "LKR"): string {
  return formatDecimal(minor, CURRENCY_DECIMALS[currency] ?? 2).replace(/,/g, "");
}

export function formatQty(qty100: number): string {
  const s = formatDecimal(qty100, 2);
  return s.replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

export function formatRate(bp: number): string {
  return formatQty(bp) + "%";
}

export function lineAmount(qty100: number, unitPrice: number): number {
  return toSafeNumber(divRoundHalfUp(BigInt(qty100) * BigInt(unitPrice), 100n));
}

export function percentOf(amount: number, bp: number): number {
  return toSafeNumber(divRoundHalfUp(BigInt(amount) * BigInt(bp), 10000n));
}

export function normaliseItems(items: Omit<LineItem, "amount">[]): LineItem[] {
  return items.map((i) => {
    if (!Number.isInteger(i.qty100) || i.qty100 <= 0) throw new Error("Each line needs a quantity above zero");
    if (!Number.isInteger(i.unitPrice) || i.unitPrice < 0) throw new Error("Unit price cannot be negative");
    return { ...i, amount: lineAmount(i.qty100, i.unitPrice) };
  });
}

/** Server-side totals. Discount comes off the subtotal; tax applies to the discounted amount. */
export function computeTotals(items: LineItem[], discount: Discount, tax: Tax): Totals {
  const subtotal = items.reduce((s, i) => s + lineAmount(i.qty100, i.unitPrice), 0);
  let discountTotal = 0;
  if (discount.type === "amount") discountTotal = discount.value;
  if (discount.type === "percent") discountTotal = percentOf(subtotal, discount.value);
  if (discountTotal < 0) throw new Error("Discount cannot be negative");
  if (discountTotal > subtotal) throw new Error("Discount cannot be more than the subtotal");
  const taxable = subtotal - discountTotal;
  const taxTotal = tax.rateBp > 0 ? percentOf(taxable, tax.rateBp) : 0;
  return { subtotal, discountTotal, taxTotal, total: taxable + taxTotal };
}

/** Splits `total` across milestones. Percent milestones are rounded; the last one absorbs rounding. */
export function splitByMilestones(total: number, milestones: { type: "percent" | "amount"; value: number }[]): number[] {
  const out = milestones.map((m) => (m.type === "percent" ? percentOf(total, m.value) : m.value));
  const sum = out.reduce((a, b) => a + b, 0);
  const allPercent = milestones.every((m) => m.type === "percent");
  const pctSum = milestones.reduce((a, m) => a + (m.type === "percent" ? m.value : 0), 0);
  if (allPercent && pctSum === 10000 && out.length > 0) out[out.length - 1] += total - sum;
  return out;
}
