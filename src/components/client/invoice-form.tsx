"use client";

import { useState } from "react";
import { ActionForm, Checkbox, Field, Select, SubmitButton, TextArea } from "./action-form";
import { LineItemsEditor, type EditableItem } from "./line-items";
import { formatDate } from "@/lib/dates";
import type { ActionResult } from "@/lib/errors";

export interface InvoiceFormDefaults {
  id?: string;
  companyId: string;
  issueDate: string;
  dueDate: string;
  currency: string;
  items: EditableItem[];
  discount: { type: string; value: string };
  tax: { label: string; rate: string };
  notes: string;
  paymentInstructions: string;
  billingPeriod: string;
  remindersEnabled: boolean;
}

function addDays(date: string, days: number) {
  const d = new Date(date + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return date;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function InvoiceForm({
  action,
  companies,
  defaults,
  currencies,
}: {
  action: (fd: FormData) => Promise<ActionResult>;
  companies: { id: string; name: string; currency: string; terms: number }[];
  defaults: InvoiceFormDefaults;
  currencies: string[];
}) {
  const [companyId, setCompanyId] = useState(defaults.companyId);
  const [currency, setCurrency] = useState(defaults.currency);
  const [issue, setIssue] = useState(defaults.issueDate);
  const [due, setDue] = useState(defaults.dueDate);

  const onCompany = (id: string) => {
    setCompanyId(id);
    const co = companies.find((c) => c.id === id);
    if (co && !defaults.id) {
      setCurrency(co.currency);
      setDue(addDays(issue, co.terms));
    }
  };

  return (
    <ActionForm
      action={action}
      className="space-y-6"
      confirm={(fd) =>
        fd.get("intent") === "send"
          ? {
              title: "Save and send this invoice?",
              summary: `It will be emailed with the PDF to the contacts of ${companies.find((c) => c.id === companyId)?.name ?? "the company"}, due ${formatDate(due)}. After sending, the invoice is locked; to correct it you void it and issue a new one.`,
              confirmLabel: "Send invoice",
            }
          : null
      }
    >
      {defaults.id && <input type="hidden" name="id" value={defaults.id} />}
      <section className="grid gap-4 rounded-lg border border-line bg-white p-4 sm:grid-cols-2 sm:p-6 lg:grid-cols-4">
        <Select name="companyId" label="Company" value={companyId} onChange={(e) => onCompany(e.target.value)} className="sm:col-span-2"
          options={[{ value: "", label: "Choose a company…" }, ...companies.map((c) => ({ value: c.id, label: c.name }))]} />
        <Select name="currency" label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)} options={currencies.map((c) => ({ value: c, label: c }))} />
        <Field name="billingPeriod" label="Billing period" placeholder="e.g. November 2026" defaultValue={defaults.billingPeriod} hint="Optional, for retainers" />
        <Field name="issueDate" label="Issue date" type="date" value={issue} onChange={(e) => { setIssue(e.target.value); const co = companies.find((c) => c.id === companyId); if (co && !defaults.id) setDue(addDays(e.target.value, co.terms)); }} required />
        <Field name="dueDate" label="Due date" type="date" value={due} onChange={(e) => setDue(e.target.value)} required hint="Filled from the company's payment terms" />
      </section>

      <section className="rounded-lg border border-line bg-white p-4 sm:p-6">
        <h2 className="mb-3 text-base font-semibold">Line items</h2>
        <LineItemsEditor initial={defaults.items} currency={currency} discount={defaults.discount} tax={defaults.tax} />
      </section>

      <section className="grid gap-4 rounded-lg border border-line bg-white p-4 sm:grid-cols-2 sm:p-6">
        <TextArea name="notes" label="Notes" defaultValue={defaults.notes} hint="Shown on the invoice." />
        <TextArea name="paymentInstructions" label="Payment instructions" defaultValue={defaults.paymentInstructions} hint="Bank details from Settings are added automatically." />
        <Checkbox name="remindersEnabled" label="Send payment reminders for this invoice" defaultChecked={defaults.remindersEnabled} />
      </section>

      <div className="sticky bottom-0 -mx-4 flex flex-col-reverse gap-2 border-t border-line bg-white/95 px-4 py-3 backdrop-blur sm:mx-0 sm:flex-row sm:justify-end sm:rounded-lg sm:border">
        <SubmitButton variant="secondary" name="intent" value="draft">Save draft</SubmitButton>
        <SubmitButton name="intent" value="send">Save and send</SubmitButton>
      </div>
    </ActionForm>
  );
}
