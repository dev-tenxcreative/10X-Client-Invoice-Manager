import { Card, PageHeader } from "@/components/ui";
import { ActionForm, Field, FileField, Select, SubmitButton } from "@/components/client/action-form";
import { createProposalAction, uploadProposalAction } from "@/app/actions/admin";
import { listCompanies } from "@/lib/services/companies";
import { getSettings } from "@/lib/services/settings";
import { PROPOSAL_TEMPLATES } from "@/lib/documents/proposal-templates";
import { addDays, today } from "@/lib/dates";

export const metadata = { title: "New proposal" };

export default async function NewProposalPage({ searchParams }: { searchParams: Promise<{ company?: string }> }) {
  const sp = await searchParams;
  const [companies, settings] = await Promise.all([listCompanies({ status: "active" }), getSettings()]);
  const companyOptions = [{ value: "", label: "Choose a company…" }, ...companies.map((c) => ({ value: c._id.toHexString(), label: c.name }))];
  const t = today();
  return (
    <>
      <PageHeader title="New proposal" description="Build it in the portal from a template, or upload a finished PDF." back={{ href: "/admin/proposals", label: "Proposals" }} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Build in the portal">
          <ActionForm action={createProposalAction} className="space-y-4">
            <Select name="companyId" label="Company" defaultValue={sp.company ?? ""} options={companyOptions} />
            <fieldset>
              <legend className="mb-2 text-sm font-medium">Start from a template</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {Object.entries(PROPOSAL_TEMPLATES).map(([key, tpl], i) => (
                  <label key={key} className="flex cursor-pointer items-start gap-2 rounded-md border border-line p-3 text-sm has-[:checked]:border-brand has-[:checked]:bg-brand-soft">
                    <input type="radio" name="template" value={key} defaultChecked={i === 0} className="mt-0.5 accent-brand" />
                    <span><span className="font-semibold">{tpl.label}</span>{tpl.projectTitle && <span className="block text-xs text-muted">{tpl.projectTitle}</span>}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <Field name="title" label="Proposal title" placeholder="Leave empty to use the template's title" />
            <SubmitButton>Start building</SubmitButton>
          </ActionForm>
        </Card>
        <Card title="Upload a finished PDF">
          <ActionForm action={uploadProposalAction} className="grid gap-4 sm:grid-cols-2">
            <Select name="companyId" label="Company" defaultValue={sp.company ?? ""} options={companyOptions} className="sm:col-span-2" />
            <Field name="title" label="Title" required className="sm:col-span-2" />
            <Field name="reference" label="Reference" hint="Leave empty to assign the next number" />
            <Select name="currency" label="Currency" defaultValue={settings.defaultCurrency} options={settings.currencies.map((c) => ({ value: c, label: c }))} />
            <Field name="date" label="Date" type="date" defaultValue={t} required />
            <Field name="validUntil" label="Valid until" type="date" defaultValue={addDays(t, 30)} required />
            <Field name="total" label="Total" inputMode="decimal" required className="sm:col-span-2" />
            <div className="sm:col-span-2"><FileField name="file" label="Proposal PDF" accept=".pdf,application/pdf" hint="PDF only, up to 10 MB." required /></div>
            <div className="sm:col-span-2"><SubmitButton pendingText="Uploading…">Upload proposal</SubmitButton></div>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
