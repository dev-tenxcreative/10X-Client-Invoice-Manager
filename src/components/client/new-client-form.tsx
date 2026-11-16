"use client";

import { useMemo, useState } from "react";
import { ActionForm, Checkbox, Field, Select, SubmitButton, TextArea } from "./action-form";
import { inputClass, labelClass } from "../ui";
import type { ActionResult } from "@/lib/errors";

export function NewClientForm({
  action,
  checkDuplicates,
  companies,
  defaults,
}: {
  action: (fd: FormData) => Promise<ActionResult>;
  checkDuplicates: (email: string, companyName: string) => Promise<{ email?: string; companyName?: string }>;
  companies: { id: string; name: string }[];
  defaults: { currency: string; paymentTermsDays: number };
}) {
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState("");
  const [dup, setDup] = useState<{ email?: string; companyName?: string }>({});
  const filtered = useMemo(() => companies.filter((c) => c.name.toLowerCase().includes(q.toLowerCase())).slice(0, 50), [companies, q]);

  const check = async (email: string, companyName: string) => {
    try {
      setDup(await checkDuplicates(email, companyName));
    } catch {
      /* the server checks again on save */
    }
  };

  return (
    <ActionForm action={action} className="space-y-6">
      <input type="hidden" name="mode" value={mode} />
      <section className="rounded-lg border border-line bg-white p-4 sm:p-6">
        <h2 className="mb-4 text-base font-semibold">Contact person</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="contact.name" label="Full name" required autoComplete="off" />
          <div>
            <Field name="contact.email" label="Email" type="email" required autoComplete="off" onBlur={(e) => check(e.currentTarget.value, "")} />
            {dup.email && <p className="mt-1 text-xs font-medium text-amber-700">{dup.email}</p>}
          </div>
          <Field name="contact.phone" label="Phone" type="tel" />
          <Field name="contact.designation" label="Designation" placeholder="e.g. Marketing Manager" />
        </div>
      </section>

      <section className="rounded-lg border border-line bg-white p-4 sm:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold">Company</h2>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <span className="text-muted">Add to an existing company</span>
            <button
              type="button"
              role="switch"
              aria-checked={mode === "existing"}
              onClick={() => setMode((m) => (m === "new" ? "existing" : "new"))}
              className={`relative h-6 w-11 rounded-full transition-colors ${mode === "existing" ? "bg-brand" : "bg-zinc-300"}`}
            >
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${mode === "existing" ? "left-5" : "left-0.5"}`} />
            </button>
          </label>
        </div>

        {mode === "existing" ? (
          <div className="space-y-2">
            <label htmlFor="company-search" className={labelClass}>Find the company</label>
            <input id="company-search" className={inputClass} placeholder="Type to search…" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="max-h-64 overflow-y-auto rounded-md border border-line" role="radiogroup" aria-label="Companies">
              {filtered.length === 0 && <p className="p-3 text-sm text-muted">No company matches “{q}”.</p>}
              {filtered.map((c) => (
                <label key={c.id} className={`flex cursor-pointer items-center gap-2 border-b border-line px-3 py-2 text-sm last:border-0 ${picked === c.id ? "bg-brand-soft" : "hover:bg-zinc-50"}`}>
                  <input type="radio" name="existingCompanyId" value={c.id} checked={picked === c.id} onChange={() => setPicked(c.id)} className="accent-brand" />
                  {c.name}
                </label>
              ))}
            </div>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field name="company.name" label="Company name" required onBlur={(e) => check("", e.currentTarget.value)} />
              {dup.companyName && <p className="mt-1 text-xs font-medium text-amber-700">{dup.companyName}</p>}
            </div>
            <Field name="company.billingAddress" label="Billing address" required className="sm:col-span-2" />
            <Field name="company.city" label="City" required defaultValue="Colombo" />
            <Field name="company.country" label="Country" required defaultValue="Sri Lanka" />
            <Field name="company.taxNumber" label="Registration or tax number" hint="Optional" />
            <Field name="company.billingEmails" label="Extra billing emails (CC)" hint="Separate with commas" />
            <Select name="company.currency" label="Default currency" defaultValue={defaults.currency} options={[{ value: "LKR", label: "LKR (Sri Lankan rupee)" }, { value: "USD", label: "USD (US dollar)" }]} />
            <Field name="company.paymentTermsDays" label="Payment terms (days)" type="number" min={0} max={120} defaultValue={defaults.paymentTermsDays} required />
            <TextArea name="company.notes" label="Internal notes" hint="Only admins can see these." className="sm:col-span-2" />
          </div>
        )}
      </section>

      <div className="flex flex-col gap-4 rounded-lg border border-line bg-white p-4 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <Checkbox name="sendInvite" label="Send invitation now" defaultChecked hint="Emails a link to set their password. The link works once and expires in 72 hours." />
        <SubmitButton pendingText="Saving…">Save client</SubmitButton>
      </div>
    </ActionForm>
  );
}
