import { ObjectId } from "mongodb";
import { z } from "zod";
import { AppError, ValidationError } from "./errors";
import { isDateString } from "./dates";
import { parseQty, parseRateBp, toMinor } from "./money";
import type { Currency, Discount, LineItem, Tax } from "./types";

/* Server-side input validation helpers. All input is validated with Zod on the server. */

export function formObject(fd: FormData): Record<string, string> {
  const o: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === "string") o[k] = v;
  return o;
}

export function parseWith<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (r.success) return r.data;
  const fieldErrors: Record<string, string> = {};
  for (const issue of r.error.issues) {
    const key = issue.path.join(".") || "form";
    fieldErrors[key] ??= issue.message;
  }
  throw new ValidationError(fieldErrors);
}

export const zText = (label: string, max = 200) => z.string().trim().min(1, `Please enter ${label}.`).max(max, `${label[0].toUpperCase()}${label.slice(1)} is too long.`);
export const zOptText = (max = 2000) => z.string().trim().max(max, "This is too long.").optional().transform((v) => v || undefined);
export const zEmail = z.string().trim().toLowerCase().email("Please enter a valid email address.").max(200);
export const zDate = (label = "a date") => z.string().refine(isDateString, `Please enter ${label}.`);
export const zOptDate = z.string().optional().transform((v) => v || undefined).refine((v) => !v || isDateString(v), "Please enter a valid date.");
export const zCurrency = z.enum(["LKR", "USD"], { message: "Please choose a currency." });
export const zId = z.string().refine((v) => ObjectId.isValid(v), "Please make a choice.").transform((v) => new ObjectId(v));
export const zInt = (label: string, min: number, max: number) =>
  z.coerce.number({ message: `Please enter ${label}.` }).int(`${label} must be a whole number.`).min(min, `${label} must be at least ${min}.`).max(max, `${label} must be at most ${max}.`);
export const zBool = z.string().optional().transform((v) => v === "on" || v === "true" || v === "1");

export function moneyField(raw: string | undefined, currency: string, field: string, opts: { allowZero?: boolean } = {}): number {
  try {
    const v = toMinor(raw ?? "", currency);
    if (v < 0 || (!opts.allowZero && v === 0)) throw new Error();
    return v;
  } catch {
    throw new ValidationError({ [field]: opts.allowZero ? "Please enter an amount (0 or more)." : "Please enter an amount above zero." });
  }
}

export function parseEmails(raw: string | undefined, field: string): string[] {
  const list = (raw ?? "").split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  for (const e of list) if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new ValidationError({ [field]: `"${e}" is not a valid email address.` });
  return [...new Set(list)];
}

const rawItem = z.object({
  title: z.string().max(300),
  detail: z.string().max(3000).optional(),
  qty: z.union([z.string(), z.number()]),
  unitPrice: z.union([z.string(), z.number()]),
  period: z.string().max(60).optional(),
});

/** Line items arrive as JSON from the line-item editor. */
export function parseItems(json: string | undefined, currency: Currency, opts: { allowZeroPrice?: boolean; allowEmpty?: boolean } = {}): Omit<LineItem, "amount">[] {
  let arr: unknown;
  try {
    arr = JSON.parse(json || "[]");
  } catch {
    throw new ValidationError({ items: "The line items could not be read." });
  }
  const items = z.array(rawItem).max(100).safeParse(arr);
  if (!items.success) throw new ValidationError({ items: "Please check the line items." });
  const rows = items.data.filter((i) => i.title.trim() || String(i.unitPrice).trim());
  if (!opts.allowEmpty && rows.length === 0) throw new ValidationError({ items: "Add at least one line item." });
  return rows.map((i, n) => {
    if (!i.title.trim()) throw new ValidationError({ items: `Line ${n + 1} needs a title.` });
    let qty100: number, unitPrice: number;
    try {
      qty100 = parseQty(String(i.qty || "1"));
    } catch {
      throw new ValidationError({ items: `Line ${n + 1}: quantity must be a number above zero.` });
    }
    try {
      unitPrice = toMinor(String(i.unitPrice || "0"), currency);
      if (unitPrice < 0 || (!opts.allowZeroPrice && unitPrice === 0)) throw new Error();
    } catch {
      throw new ValidationError({ items: `Line ${n + 1}: please enter a unit price${opts.allowZeroPrice ? "" : " above zero"}.` });
    }
    return { title: i.title.trim(), detail: i.detail?.trim() || undefined, qty100, unitPrice, period: i.period?.trim() || undefined };
  });
}

export function parseDiscount(type: string | undefined, value: string | undefined, currency: Currency): Discount {
  if (!type || type === "none" || !value?.trim()) return { type: "none", value: 0 };
  try {
    if (type === "percent") return { type: "percent", value: parseRateBp(value) };
    return { type: "amount", value: toMinor(value, currency) };
  } catch {
    throw new ValidationError({ discountValue: "Please enter a valid discount." });
  }
}

export function parseTax(label: string | undefined, rate: string | undefined): Tax {
  try {
    const rateBp = rate?.trim() ? parseRateBp(rate) : 0;
    return { label: (label ?? "").trim().slice(0, 40) || "Tax", rateBp };
  } catch {
    throw new ValidationError({ taxRate: "Tax rate must be between 0 and 100." });
  }
}

export function fileFrom(fd: FormData, name: string): File | null {
  const f = fd.get(name);
  return f && typeof f !== "string" && f.size > 0 ? f : null;
}

export function oid(v: string | undefined | null): ObjectId {
  if (!v || !ObjectId.isValid(v)) throw new AppError("That record could not be found.");
  return new ObjectId(v);
}
