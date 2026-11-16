"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import clsx from "clsx";
import { inputClass, labelClass, buttonClass } from "../ui";
import { LineItemsEditor, type EditableItem } from "./line-items";
import { DocFrame } from "./doc-frame";
import { useToast } from "./toast";
import { renderProposalHtml, type ProposalDocData } from "@/lib/documents/proposal-html";
import { TABLE_SECTIONS } from "@/lib/documents/proposal-templates";
import { computeTotals, normaliseItems, parseQty, parseRateBp, toMinor } from "@/lib/money";
import type { ActionResult } from "@/lib/errors";
import type { Currency, ProposalContent } from "@/lib/types";

export interface BuilderState {
  title: string;
  projectTitle: string;
  date: string;
  validUntil: string;
  currency: string;
  sections: { key: string; title: string; body: string; hidden: boolean }[];
  investment: EditableItem[];
  investmentNotes: string;
  discountType: string;
  discountValue: string;
  taxLabel: string;
  taxRate: string;
  timeline: { phase: string; duration: string; notes: string }[];
  paymentSchedule: { label: string; type: "percent" | "amount"; value: string; dueNote: string }[];
}

function safe<T>(fn: () => T, fb: T): T {
  try {
    return fn();
  } catch {
    return fb;
  }
}

function toContent(s: BuilderState): { content: ProposalContent; totals: ReturnType<typeof computeTotals> } {
  const cur = (s.currency === "USD" ? "USD" : "LKR") as Currency;
  const investment = safe(() => normaliseItems(s.investment.filter((i) => i.title.trim()).map((i) => ({ title: i.title, detail: i.detail || undefined, qty100: safe(() => parseQty(i.qty || "1"), 100), unitPrice: safe(() => toMinor(i.unitPrice || "0", cur), 0) }))), []);
  const discount = s.discountType === "none" || !s.discountValue ? { type: "none" as const, value: 0 } : s.discountType === "percent" ? { type: "percent" as const, value: safe(() => parseRateBp(s.discountValue), 0) } : { type: "amount" as const, value: safe(() => toMinor(s.discountValue, cur), 0) };
  const tax = { label: s.taxLabel || "Tax", rateBp: safe(() => parseRateBp(s.taxRate || "0"), 0) };
  const totals = safe(() => computeTotals(investment, discount, tax), { subtotal: 0, discountTotal: 0, taxTotal: 0, total: 0 });
  return {
    content: {
      title: s.title, projectTitle: s.projectTitle, date: s.date, validUntil: s.validUntil, currency: cur, sections: s.sections, investment,
      investmentNotes: s.investmentNotes, discount, tax,
      timeline: s.timeline.filter((r) => r.phase.trim()),
      paymentSchedule: s.paymentSchedule.filter((m) => m.label.trim()).map((m) => ({ label: m.label, type: m.type, value: m.type === "percent" ? safe(() => parseRateBp(m.value), 0) : safe(() => toMinor(m.value, cur), 0), dueNote: m.dueNote })),
    },
    totals,
  };
}

export function ProposalBuilder({
  id,
  initial,
  reference: initialRef,
  status,
  save,
  preview,
  textBlocks,
}: {
  id: string;
  initial: BuilderState;
  reference: string;
  status: string;
  save: (id: string, json: string, reference?: string) => Promise<ActionResult<{ versioned: boolean }>>;
  preview: Omit<ProposalDocData, "content" | "totals" | "proposal"> & { proposal: Omit<ProposalDocData["proposal"], "reference"> };
  textBlocks: { id: string; title: string; body: string }[];
}) {
  const [s, setS] = useState<BuilderState>(initial);
  const [reference, setReference] = useState(initialRef);
  const [view, setView] = useState<"edit" | "preview">("edit");
  const [saveState, setSaveState] = useState<{ kind: "idle" | "saving" | "saved" | "error"; text?: string }>({ kind: "idle" });
  const [, start] = useTransition();
  const dirty = useRef(false);
  const toast = useToast();
  const isDraft = status === "draft";

  const set = (patch: Partial<BuilderState>) => {
    dirty.current = true;
    setS((prev) => ({ ...prev, ...patch }));
  };

  const doSave = useCallback(
    (explicit: boolean) => {
      setSaveState({ kind: "saving" });
      start(async () => {
        try {
          const res = await save(id, JSON.stringify(s), isDraft ? reference : undefined);
          if (res.ok) {
            dirty.current = false;
            setSaveState({ kind: "saved", text: new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) });
            if (res.message) toast.success(res.message);
            if (res.data?.versioned) window.location.href = `/admin/proposals/${id}`;
            else if (explicit) toast.success("Proposal saved.");
          } else {
            setSaveState({ kind: "error", text: res.error });
            if (explicit) toast.error(res.error);
          }
        } catch {
          setSaveState({ kind: "error", text: "Could not reach the server." });
        }
      });
    },
    [id, s, reference, isDraft, save, toast],
  );

  // Autosave drafts 2.5 seconds after the last change.
  useEffect(() => {
    if (!isDraft || !dirty.current) return;
    const tm = setTimeout(() => doSave(false), 2500);
    return () => clearTimeout(tm);
  }, [s, reference, isDraft, doSave]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  const html = useMemo(() => {
    if (view !== "preview") return "";
    const { content, totals } = toContent(s);
    return renderProposalHtml({ ...preview, proposal: { ...preview.proposal, reference }, content, totals }, "screen");
  }, [view, s, preview, reference]);

  const moveSection = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= s.sections.length) return;
    const next = [...s.sections];
    [next[i], next[j]] = [next[j], next[i]];
    set({ sections: next });
  };
  const updateSection = (i: number, patch: Partial<BuilderState["sections"][number]>) => set({ sections: s.sections.map((x, n) => (n === i ? { ...x, ...patch } : x)) });

  const pctSum = s.paymentSchedule.filter((m) => m.type === "percent").reduce((a, m) => a + safe(() => parseRateBp(m.value), 0), 0);

  return (
    <div>
      <div className="sticky top-16 z-10 -mx-4 mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-line bg-canvas/95 px-4 py-2 backdrop-blur sm:mx-0 sm:rounded-lg sm:border sm:bg-white">
        <div className="flex gap-1" role="tablist">
          {(["edit", "preview"] as const).map((v) => (
            <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)}
              className={clsx("rounded-md px-3 py-1.5 text-sm font-medium", view === v ? "bg-ink text-white" : "text-muted hover:bg-zinc-100")}>
              {v === "edit" ? "Edit" : "Preview"}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted" aria-live="polite">
            {saveState.kind === "saving" && "Saving…"}
            {saveState.kind === "saved" && `Saved at ${saveState.text}`}
            {saveState.kind === "error" && <span className="text-red-700">Not saved: {saveState.text}</span>}
            {saveState.kind === "idle" && (isDraft ? "Changes save automatically" : "Saving creates a new version")}
          </span>
          <button type="button" className={buttonClass("primary")} onClick={() => doSave(true)}>{isDraft ? "Save now" : "Save as new version"}</button>
        </div>
      </div>

      {view === "preview" ? (
        <DocFrame html={html} title="Proposal preview" />
      ) : (
        <div className="space-y-4">
          <section className="grid gap-4 rounded-lg border border-line bg-white p-4 sm:grid-cols-2 sm:p-6">
            <h2 className="text-base font-semibold sm:col-span-2">Cover details</h2>
            <div><label className={labelClass} htmlFor="p-title">Proposal title</label><input id="p-title" className={inputClass} value={s.title} onChange={(e) => set({ title: e.target.value })} /></div>
            <div><label className={labelClass} htmlFor="p-project">Project title</label><input id="p-project" className={inputClass} value={s.projectTitle} onChange={(e) => set({ projectTitle: e.target.value })} /></div>
            <div><label className={labelClass} htmlFor="p-ref">Reference</label><input id="p-ref" className={inputClass} value={reference} disabled={!isDraft} onChange={(e) => { dirty.current = true; setReference(e.target.value); }} />{!isDraft && <p className="mt-1 text-xs text-muted">The reference cannot change after sending.</p>}</div>
            <div><label className={labelClass} htmlFor="p-cur">Currency</label>
              <select id="p-cur" className={inputClass} value={s.currency} onChange={(e) => set({ currency: e.target.value })}><option>LKR</option><option>USD</option></select></div>
            <div><label className={labelClass} htmlFor="p-date">Date</label><input id="p-date" type="date" className={inputClass} value={s.date} onChange={(e) => set({ date: e.target.value })} /></div>
            <div><label className={labelClass} htmlFor="p-valid">Valid until</label><input id="p-valid" type="date" className={inputClass} value={s.validUntil} onChange={(e) => set({ validUntil: e.target.value })} /></div>
          </section>

          {s.sections.map((sec, i) => (
            <section key={sec.key} className={clsx("rounded-lg border border-line bg-white p-4 sm:p-6", sec.hidden && "opacity-60")}>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-brand">{i + 1}.</span>
                <label className="sr-only" htmlFor={`sec-t-${sec.key}`}>Section title</label>
                <input id={`sec-t-${sec.key}`} className={clsx(inputClass, "max-w-sm flex-1 font-semibold")} value={sec.title} onChange={(e) => updateSection(i, { title: e.target.value })} />
                <div className="ml-auto flex gap-1">
                  <button type="button" onClick={() => moveSection(i, -1)} disabled={i === 0} className="rounded px-2 py-1 text-xs text-muted hover:bg-zinc-100 disabled:opacity-30" aria-label="Move section up">↑</button>
                  <button type="button" onClick={() => moveSection(i, 1)} disabled={i === s.sections.length - 1} className="rounded px-2 py-1 text-xs text-muted hover:bg-zinc-100 disabled:opacity-30" aria-label="Move section down">↓</button>
                  <button type="button" onClick={() => updateSection(i, { hidden: !sec.hidden })} className="rounded px-2 py-1 text-xs font-medium text-ink hover:bg-zinc-100" aria-pressed={sec.hidden}>{sec.hidden ? "Show" : "Hide"}</button>
                </div>
              </div>
              <label className="sr-only" htmlFor={`sec-b-${sec.key}`}>Section text</label>
              <textarea id={`sec-b-${sec.key}`} rows={TABLE_SECTIONS.has(sec.key) ? 2 : sec.key === "terms" ? 14 : 5} className={clsx(inputClass, "font-mono text-[13px]")} value={sec.body}
                placeholder={TABLE_SECTIONS.has(sec.key) ? "Optional introduction" : "Write here. Use **bold**, - bullet lists, 1. numbered lists and [links](https://…)."}
                onChange={(e) => updateSection(i, { body: e.target.value })} />
              {textBlocks.length > 0 && !TABLE_SECTIONS.has(sec.key) && (
                <div className="mt-2">
                  <label className="text-xs text-muted" htmlFor={`tb-${sec.key}`}>Insert saved text: </label>
                  <select id={`tb-${sec.key}`} className="rounded border border-line bg-white px-2 py-1 text-xs" value="" onChange={(e) => {
                    const b = textBlocks.find((x) => x.id === e.target.value);
                    if (b) updateSection(i, { body: sec.body ? `${sec.body}\n\n${b.body}` : b.body });
                  }}>
                    <option value="">Choose…</option>
                    {textBlocks.map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
                  </select>
                </div>
              )}

              {sec.key === "investment" && (
                <div className="mt-4">
                  <LineItemsEditor name="__investment" initial={s.investment} currency={s.currency} showPeriod={false} allowZeroPrice
                    discount={{ type: s.discountType, value: s.discountValue }} tax={{ label: s.taxLabel, rate: s.taxRate }}
                    onChange={(v) => set({ investment: v.items, discountType: v.discount.type, discountValue: v.discount.value, taxLabel: v.tax.label, taxRate: v.tax.rate })} />
                  <label className={clsx(labelClass, "mt-4")} htmlFor="inv-notes">Notes under the table</label>
                  <textarea id="inv-notes" rows={2} className={inputClass} value={s.investmentNotes} onChange={(e) => set({ investmentNotes: e.target.value })} placeholder="e.g. Hosting is billed separately." />
                </div>
              )}

              {sec.key === "timeline" && (
                <div className="mt-4 space-y-2">
                  {s.timeline.map((r, n) => (
                    <div key={n} className="grid gap-2 sm:grid-cols-[1fr_160px_1fr_auto]">
                      <input aria-label="Phase" className={inputClass} placeholder="Phase or milestone" value={r.phase} onChange={(e) => set({ timeline: s.timeline.map((x, k) => (k === n ? { ...x, phase: e.target.value } : x)) })} />
                      <input aria-label="Duration" className={inputClass} placeholder="Duration" value={r.duration} onChange={(e) => set({ timeline: s.timeline.map((x, k) => (k === n ? { ...x, duration: e.target.value } : x)) })} />
                      <input aria-label="Notes" className={inputClass} placeholder="Notes" value={r.notes} onChange={(e) => set({ timeline: s.timeline.map((x, k) => (k === n ? { ...x, notes: e.target.value } : x)) })} />
                      <button type="button" className="text-xs text-red-700" onClick={() => set({ timeline: s.timeline.filter((_, k) => k !== n) })}>Remove</button>
                    </div>
                  ))}
                  <button type="button" className="rounded-md border border-dashed border-zinc-300 px-3 py-1.5 text-sm" onClick={() => set({ timeline: [...s.timeline, { phase: "", duration: "", notes: "" }] })}>+ Add row</button>
                </div>
              )}

              {sec.key === "payment_schedule" && (
                <div className="mt-4 space-y-2">
                  {s.paymentSchedule.map((m, n) => (
                    <div key={n} className="grid gap-2 sm:grid-cols-[1fr_120px_140px_1fr_auto]">
                      <input aria-label="Milestone" className={inputClass} placeholder="e.g. Advance on acceptance" value={m.label} onChange={(e) => set({ paymentSchedule: s.paymentSchedule.map((x, k) => (k === n ? { ...x, label: e.target.value } : x)) })} />
                      <select aria-label="Type" className={inputClass} value={m.type} onChange={(e) => set({ paymentSchedule: s.paymentSchedule.map((x, k) => (k === n ? { ...x, type: e.target.value as "percent" | "amount" } : x)) })}><option value="percent">Percent</option><option value="amount">Amount</option></select>
                      <input aria-label="Value" inputMode="decimal" className={inputClass} placeholder={m.type === "percent" ? "50" : "0.00"} value={m.value} onChange={(e) => set({ paymentSchedule: s.paymentSchedule.map((x, k) => (k === n ? { ...x, value: e.target.value } : x)) })} />
                      <input aria-label="When" className={inputClass} placeholder="When, e.g. Before launch" value={m.dueNote} onChange={(e) => set({ paymentSchedule: s.paymentSchedule.map((x, k) => (k === n ? { ...x, dueNote: e.target.value } : x)) })} />
                      <button type="button" className="text-xs text-red-700" onClick={() => set({ paymentSchedule: s.paymentSchedule.filter((_, k) => k !== n) })}>Remove</button>
                    </div>
                  ))}
                  <div className="flex flex-wrap items-center gap-3">
                    <button type="button" className="rounded-md border border-dashed border-zinc-300 px-3 py-1.5 text-sm" onClick={() => set({ paymentSchedule: [...s.paymentSchedule, { label: "", type: "percent", value: "", dueNote: "" }] })}>+ Add milestone</button>
                    {s.paymentSchedule.length > 0 && s.paymentSchedule.every((m) => m.type === "percent") && (
                      <span className={clsx("text-xs", pctSum === 10000 ? "text-emerald-700" : "text-red-700")}>Total: {pctSum / 100}% {pctSum === 10000 ? "✓" : "(must be 100%)"}</span>
                    )}
                  </div>
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
