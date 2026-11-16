"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { inputClass } from "../ui";
import { useFieldError } from "./action-form";
import { computeTotals, formatMoney, normaliseItems, parseQty, parseRateBp, toMinor } from "@/lib/money";

export interface EditableItem {
  title: string;
  detail: string;
  qty: string;
  unitPrice: string;
  period: string;
}

export const emptyItem = (): EditableItem => ({ title: "", detail: "", qty: "1", unitPrice: "", period: "" });

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/**
 * Line items + discount + tax editor. Totals shown here are a preview only; the server
 * recalculates every amount when saving.
 */
export function LineItemsEditor({
  initial,
  currency,
  showPeriod = true,
  discount: initialDiscount = { type: "none", value: "" },
  tax: initialTax = { label: "VAT", rate: "0" },
  allowZeroPrice,
  onChange,
  name = "items",
}: {
  initial: EditableItem[];
  currency: string;
  showPeriod?: boolean;
  discount?: { type: string; value: string };
  tax?: { label: string; rate: string };
  allowZeroPrice?: boolean;
  onChange?: (v: { items: EditableItem[]; discount: { type: string; value: string }; tax: { label: string; rate: string } }) => void;
  name?: string;
}) {
  const [items, setItems] = useState<EditableItem[]>(initial.length ? initial : [emptyItem()]);
  const [discount, setDiscount] = useState(initialDiscount);
  const [tax, setTax] = useState(initialTax);
  const err = useFieldError(name);
  const discErr = useFieldError("discountValue");
  const taxErr = useFieldError("taxRate");

  // Report changes after state settles (functional updates never lose rapid edits).
  const first = useRef(true);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    onChangeRef.current?.({ items, discount, tax });
  }, [items, discount, tax]);

  const update = (i: number, patch: Partial<EditableItem>) => setItems((prev) => prev.map((it, n) => (n === i ? { ...it, ...patch } : it)));
  const move = (i: number, dir: -1 | 1) =>
    setItems((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const remove = (i: number) => setItems((prev) => {
    const next = prev.filter((_, n) => n !== i);
    return next.length ? next : [emptyItem()];
  });

  const preview = useMemo(() => {
    const parsed = items
      .filter((i) => i.title.trim() || i.unitPrice.trim())
      .map((i) => ({ title: i.title, qty100: safe(() => parseQty(i.qty || "1"), 0), unitPrice: safe(() => toMinor(i.unitPrice || "0", currency), 0) }));
    const valid = parsed.filter((p) => p.qty100 > 0);
    const lines = safe(() => normaliseItems(valid), []);
    const disc = discount.type === "none" || !discount.value
      ? { type: "none" as const, value: 0 }
      : discount.type === "percent"
        ? { type: "percent" as const, value: safe(() => parseRateBp(discount.value), 0) }
        : { type: "amount" as const, value: safe(() => toMinor(discount.value, currency), 0) };
    const t = { label: tax.label, rateBp: safe(() => parseRateBp(tax.rate || "0"), 0) };
    return { lines: items.map((i) => safe(() => (parseQty(i.qty || "1") * toMinor(i.unitPrice || "0", currency)) / 100, 0)), totals: safe(() => computeTotals(lines, disc, t), null) };
  }, [items, discount, tax, currency]);

  const serial = JSON.stringify(items.map((i) => ({ title: i.title, detail: i.detail, qty: i.qty, unitPrice: i.unitPrice, period: i.period })));

  return (
    <div>
      <input type="hidden" name={name} value={serial} />
      <input type="hidden" name="discountType" value={discount.type} />
      <input type="hidden" name="discountValue" value={discount.value} />
      <input type="hidden" name="taxLabel" value={tax.label} />
      <input type="hidden" name="taxRate" value={tax.rate} />
      {err && <p role="alert" className="mb-2 rounded-md bg-red-50 px-3 py-2 text-sm font-medium text-red-800">{err}</p>}
      <ol className="space-y-3">
        {items.map((it, i) => (
          <li key={i} className="rounded-lg border border-line bg-zinc-50/60 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">Line {i + 1}</span>
              <div className="flex gap-1">
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="rounded px-2 py-1 text-xs text-muted hover:bg-zinc-200 disabled:opacity-30" aria-label={`Move line ${i + 1} up`}>↑</button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === items.length - 1} className="rounded px-2 py-1 text-xs text-muted hover:bg-zinc-200 disabled:opacity-30" aria-label={`Move line ${i + 1} down`}>↓</button>
                <button type="button" onClick={() => remove(i)} className="rounded px-2 py-1 text-xs text-red-700 hover:bg-red-50" aria-label={`Remove line ${i + 1}`}>Remove</button>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-12">
              <div className="sm:col-span-12">
                <label className="sr-only" htmlFor={`it-title-${i}`}>Title</label>
                <input id={`it-title-${i}`} className={inputClass} placeholder="Title, e.g. Social media management" value={it.title} onChange={(e) => update(i, { title: e.target.value })} />
              </div>
              <div className="sm:col-span-12">
                <label className="sr-only" htmlFor={`it-detail-${i}`}>Details</label>
                <textarea id={`it-detail-${i}`} rows={2} className={inputClass} placeholder="Details (optional, one per line)" value={it.detail} onChange={(e) => update(i, { detail: e.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs text-muted" htmlFor={`it-qty-${i}`}>Qty / hours</label>
                <input id={`it-qty-${i}`} inputMode="decimal" className={inputClass} value={it.qty} onChange={(e) => update(i, { qty: e.target.value })} />
              </div>
              <div className="sm:col-span-4">
                <label className="text-xs text-muted" htmlFor={`it-price-${i}`}>Unit price ({currency})</label>
                <input id={`it-price-${i}`} inputMode="decimal" className={inputClass} placeholder={allowZeroPrice ? "0.00" : ""} value={it.unitPrice} onChange={(e) => update(i, { unitPrice: e.target.value })} />
              </div>
              {showPeriod && (
                <div className="sm:col-span-3">
                  <label className="text-xs text-muted" htmlFor={`it-period-${i}`}>Billing period</label>
                  <input id={`it-period-${i}`} className={inputClass} placeholder="e.g. November 2026" value={it.period} onChange={(e) => update(i, { period: e.target.value })} />
                </div>
              )}
              <div className={`flex items-end justify-end ${showPeriod ? "sm:col-span-3" : "sm:col-span-6"}`}>
                <span className="num pb-2 text-sm font-semibold">{formatMoney(Math.round(preview.lines[i] ?? 0), currency)}</span>
              </div>
            </div>
          </li>
        ))}
      </ol>
      <button type="button" onClick={() => setItems((prev) => [...prev, emptyItem()])} className="mt-3 rounded-md border border-dashed border-zinc-300 px-4 py-2 text-sm font-medium text-ink hover:bg-zinc-50">
        + Add line
      </button>

      <div className="mt-5 grid gap-4 border-t border-line pt-4 md:grid-cols-2">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted" htmlFor="disc-type">Discount</label>
            <select id="disc-type" className={inputClass} value={discount.type} onChange={(e) => { const v = e.target.value; setDiscount((d) => ({ ...d, type: v })); }}>
              <option value="none">No discount</option>
              <option value="percent">Percent</option>
              <option value="amount">Amount</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-muted" htmlFor="disc-val">{discount.type === "percent" ? "Percent" : `Amount (${currency})`}</label>
            <input id="disc-val" inputMode="decimal" disabled={discount.type === "none"} className={inputClass} value={discount.value} onChange={(e) => { const v = e.target.value; setDiscount((d) => ({ ...d, value: v })); }} aria-invalid={Boolean(discErr)} />
            {discErr && <p className="mt-1 text-xs text-red-700">{discErr}</p>}
          </div>
          <div>
            <label className="text-xs text-muted" htmlFor="tax-label">Tax label</label>
            <input id="tax-label" className={inputClass} value={tax.label} onChange={(e) => { const v = e.target.value; setTax((x) => ({ ...x, label: v })); }} />
          </div>
          <div>
            <label className="text-xs text-muted" htmlFor="tax-rate">Tax rate (%)</label>
            <input id="tax-rate" inputMode="decimal" className={inputClass} value={tax.rate} onChange={(e) => { const v = e.target.value; setTax((x) => ({ ...x, rate: v })); }} aria-invalid={Boolean(taxErr)} />
            {taxErr && <p className="mt-1 text-xs text-red-700">{taxErr}</p>}
          </div>
        </div>
        <dl className="ml-auto w-full max-w-xs space-y-1 text-sm">
          {preview.totals ? (
            <>
              <div className="flex justify-between"><dt className="text-muted">Subtotal</dt><dd className="num">{formatMoney(preview.totals.subtotal, currency)}</dd></div>
              {preview.totals.discountTotal > 0 && <div className="flex justify-between"><dt className="text-muted">Discount</dt><dd className="num">-{formatMoney(preview.totals.discountTotal, currency)}</dd></div>}
              {preview.totals.taxTotal > 0 && <div className="flex justify-between"><dt className="text-muted">{tax.label || "Tax"}</dt><dd className="num">{formatMoney(preview.totals.taxTotal, currency)}</dd></div>}
              <div className="flex justify-between border-t-2 border-brand pt-2 text-base font-bold"><dt>Total</dt><dd className="num">{formatMoney(preview.totals.total, currency)}</dd></div>
            </>
          ) : (
            <p className="text-xs text-red-700">The discount is more than the subtotal.</p>
          )}
          <p className="pt-1 text-xs text-muted">Totals are checked again on the server when you save.</p>
        </dl>
      </div>
    </div>
  );
}
