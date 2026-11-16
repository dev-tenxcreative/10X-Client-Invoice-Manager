import { Card, PageHeader } from "@/components/ui";
import { ActionForm, Checkbox, Field, FileField, Select, SubmitButton, TextArea } from "@/components/client/action-form";
import { uploadInvoiceAction } from "@/app/actions/admin";
import { listCompanies } from "@/lib/services/companies";
import { getSettings } from "@/lib/services/settings";
import { addDays, today } from "@/lib/dates";

export const metadata = { title: "Upload invoice" };

export default async function UploadInvoicePage() {
  const [companies, settings] = await Promise.all([listCompanies({ status: "active" }), getSettings()]);
  const t = today();
  return (
    <>
      <PageHeader title="Upload an invoice" description="For invoices made outside the portal. The details you type here make it count in totals, history and reminders." back={{ href: "/admin/invoices", label: "Invoices" }} />
      <Card>
        <ActionForm action={uploadInvoiceAction} className="grid gap-4 sm:grid-cols-2">
          <Select name="companyId" label="Company" className="sm:col-span-2" options={[{ value: "", label: "Choose a company…" }, ...companies.map((c) => ({ value: c._id.toHexString(), label: c.name }))]} />
          <Field name="number" label="Invoice number" required placeholder="As printed on the PDF" />
          <Select name="currency" label="Currency" defaultValue={settings.defaultCurrency} options={settings.currencies.map((c) => ({ value: c, label: c }))} />
          <Field name="issueDate" label="Issue date" type="date" defaultValue={t} required />
          <Field name="dueDate" label="Due date" type="date" defaultValue={addDays(t, settings.defaultPaymentTermsDays)} required />
          <Field name="total" label="Total amount" inputMode="decimal" required placeholder="65000.00" />
          <div className="sm:col-span-2"><FileField name="file" label="Invoice PDF" accept=".pdf,application/pdf" hint="PDF only, up to 10 MB." required /></div>
          <TextArea name="description" label="Short description" className="sm:col-span-2" />
          <div className="space-y-2 sm:col-span-2">
            <Checkbox name="markSent" label="This invoice has already been sent to the client" defaultChecked hint="It becomes visible to the client and counts as outstanding. No email is sent." />
            <Checkbox name="remindersEnabled" label="Send payment reminders for this invoice" defaultChecked />
          </div>
          <div className="sm:col-span-2"><SubmitButton pendingText="Uploading…">Upload invoice</SubmitButton></div>
        </ActionForm>
      </Card>
    </>
  );
}
