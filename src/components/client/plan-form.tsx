"use client";

import { useState } from "react";
import { ActionForm, Field, Select, SubmitButton, TextArea } from "./action-form";
import { LineItemsEditor, type EditableItem } from "./line-items";
import type { ActionResult } from "@/lib/errors";

export interface PlanFormDefaults {
  id?: string;
  companyId: string;
  name: string;
  currency: string;
  items: EditableItem[];
  discount: { type: string; value: string };
  tax: { label: string; rate: string };
  startDate: string;
  endDate: string;
  billingDay: number;
  dueAfterDays: number;
  mode: "auto" | "review";
  notes: string;
}

export function PlanForm({ action, companies, defaults, currencies }: {
  action: (fd: FormData) => Promise<ActionResult>;
  companies: { id: string; name: string; currency: string; terms: number }[];
  defaults: PlanFormDefaults;
  currencies: string[];
}) {
  const [currency, setCurrency] = useState(defaults.currency);
  const [companyId, setCompanyId] = useState(defaults.companyId);
  return (
    <ActionForm action={action} className="space-y-6"
      confirm={defaults.id ? { title: "Save plan changes?", summary: "Changes apply to future invoices only. Invoices already created keep their amounts." } : undefined}>
      {defaults.id && <input type="hidden" name="id" value={defaults.id} />}
      <section className="grid gap-4 rounded-lg border border-line bg-white p-4 sm:grid-cols-2 sm:p-6 lg:grid-cols-4">
        <Select name="companyId" label="Company" className="sm:col-span-2" value={companyId}
          onChange={(e) => { setCompanyId(e.target.value); const co = companies.find((c) => c.id === e.target.value); if (co && !defaults.id) setCurrency(co.currency); }}
          options={[{ value: "", label: "Choose a company…" }, ...companies.map((c) => ({ value: c.id, label: c.name }))]} />
        <Field name="name" label="Plan name" defaultValue={defaults.name} required placeholder="e.g. Social media retainer" className="sm:col-span-2" />
        <Select name="currency" label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)} options={currencies.map((c) => ({ value: c, label: c }))} />
        <Field name="billingDay" label="Billing day (1 to 28)" type="number" min={1} max={28} defaultValue={defaults.billingDay} required />
        <Field name="dueAfterDays" label="Due after (days)" type="number" min={0} max={120} defaultValue={defaults.dueAfterDays} required />
        <Select name="mode" label="When the invoice is created" defaultValue={defaults.mode}
          options={[{ value: "review", label: "Create draft for my review" }, { value: "auto", label: "Send automatically" }]} />
        <Field name="startDate" label="Start date" type="date" defaultValue={defaults.startDate} required />
        <Field name="endDate" label="End date" type="date" defaultValue={defaults.endDate} hint="Optional" />
      </section>
      <section className="rounded-lg border border-line bg-white p-4 sm:p-6">
        <h2 className="mb-1 text-base font-semibold">Monthly line items</h2>
        <p className="mb-3 text-sm text-muted">Leave the billing period empty: each invoice gets its month automatically, e.g. “November 2026”.</p>
        <LineItemsEditor initial={defaults.items} currency={currency} discount={defaults.discount} tax={defaults.tax} />
      </section>
      <section className="rounded-lg border border-line bg-white p-4 sm:p-6">
        <TextArea name="notes" label="Notes on each invoice" defaultValue={defaults.notes} />
      </section>
      <div className="flex justify-end"><SubmitButton>{defaults.id ? "Save plan" : "Create plan"}</SubmitButton></div>
    </ActionForm>
  );
}
