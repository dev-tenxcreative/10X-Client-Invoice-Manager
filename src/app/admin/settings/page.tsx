import Link from "next/link";
import { Card, PageHeader, Tabs, cx } from "@/components/ui";
import { ActionButton, ActionForm, Checkbox, Field, FileField, Select, SubmitButton, TextArea } from "@/components/client/action-form";
import { DocFrame } from "@/components/client/doc-frame";
import { deleteTextBlockAction, saveSettingsAction, saveTextBlockAction, testTemplateAction } from "@/app/actions/admin";
import { getSettings } from "@/lib/services/settings";
import { cols } from "@/lib/db";
import { formatRate } from "@/lib/money";
import { renderEmail } from "@/lib/email/render";
import { EMAIL_TEMPLATE_LABELS } from "@/lib/settings-defaults";
import { PROPOSAL_TEMPLATES } from "@/lib/documents/proposal-templates";

export const metadata = { title: "Settings" };

const TABS = ["company", "bank", "billing", "reminders", "emails", "texts"] as const;

const SAMPLE = {
  client_name: "Nimal Perera", company_name: "Sample Company (Pvt) Ltd", invoice_number: "10X-INV-2026-0001", amount_due: "LKR 65,000.00", amount_paid: "LKR 65,000.00",
  due_date: "30 Nov 2026", days_overdue: 7, portal_link: "https://portal.example/portal", action_link: "https://portal.example/portal", proposal_reference: "10X-PRO-2026-001",
  proposal_title: "Website redesign", proposal_total: "LKR 450,000.00", valid_until: "16 Dec 2026", reason: "The amount does not match our bank statement.", plan_name: "Social media retainer",
  response: "accepted", details: "Accepted by Nimal Perera (Director).", count: 2, today: "16 Nov 2026", list: "• 10X-INV-2026-0001, Sample Company: LKR 65,000.00 (7 days overdue)",
  unpaid_summary: "You also have 1 earlier unpaid invoice with a balance of LKR 65,000.00.",
};

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string; t?: string; block?: string }> }) {
  const sp = await searchParams;
  const tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? sp.tab! : "company";
  const s = await getSettings();
  const c = await cols();
  const blocks = tab === "texts" ? await c.textBlocks.find().sort({ category: 1, title: 1 }).toArray() : [];
  const tplKey = sp.t && s.emailTemplates[sp.t] ? sp.t : "invoice_sent";
  const tpl = s.emailTemplates[tplKey];
  const preview = tab === "emails" ? renderEmail(tpl, SAMPLE, s) : null;
  const editingBlock = blocks.find((b) => b._id.toHexString() === sp.block);

  return (
    <>
      <PageHeader title="Settings" description="Company details, bank details, tax, numbering, reminders and email templates. Empty fields are hidden on documents." />
      <Tabs current={tab} tabs={[
        { key: "company", label: "Company profile", href: "/admin/settings" },
        { key: "bank", label: "Bank details", href: "/admin/settings?tab=bank" },
        { key: "billing", label: "Tax, currency & numbering", href: "/admin/settings?tab=billing" },
        { key: "reminders", label: "Reminders", href: "/admin/settings?tab=reminders" },
        { key: "emails", label: "Email templates", href: "/admin/settings?tab=emails" },
        { key: "texts", label: "Proposal text blocks", href: "/admin/settings?tab=texts" },
      ]} />

      {tab === "company" && (
        <div className="space-y-4">
          <Card>
            <ActionForm action={saveSettingsAction} className="grid gap-4 sm:grid-cols-2">
              <input type="hidden" name="section" value="company" />
              <Field name="legalName" label="Legal name" defaultValue={s.legalName} required />
              <Field name="brandName" label="Brand name" defaultValue={s.brandName} required />
              <Field name="address" label="Address" defaultValue={s.address} required className="sm:col-span-2" />
              <Field name="phone" label="Phone" defaultValue={s.phone} required />
              <Field name="email" label="Billing email" type="email" defaultValue={s.email} required />
              <Field name="website" label="Website" defaultValue={s.website} required />
              <Field name="registrationNumber" label="Company registration number" defaultValue={s.registrationNumber} hint="Shown on invoices when set" />
              <Field name="taxNumber" label="Tax / VAT number" defaultValue={s.taxNumber} hint="Shown on invoices when set" />
              <Field name="signatoryName" label="Signatory name" defaultValue={s.signatoryName} required />
              <Field name="signatoryTitle" label="Signatory title" defaultValue={s.signatoryTitle} required />
              <div className="sm:col-span-2"><SubmitButton>Save company profile</SubmitButton></div>
            </ActionForm>
          </Card>
          <Card title="Logo file">
            <p className="mb-3 text-sm text-muted">Documents use the built-in vector 10X logo. You can store the original logo file here for reference.{s.logoFileId && <> <a className="text-brand hover:underline" href={`/api/files/${s.logoFileId}`}>View current file</a></>}</p>
            <ActionForm action={saveSettingsAction} className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <input type="hidden" name="section" value="logo" />
              <FileField name="file" label="Logo (PNG, JPG or PDF)" />
              <SubmitButton variant="secondary">Upload</SubmitButton>
            </ActionForm>
          </Card>
        </div>
      )}

      {tab === "bank" && (
        <Card>
          <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">These details print on every invoice. Check them carefully: the portal never makes up bank details.</p>
          <ActionForm action={saveSettingsAction} className="grid gap-4 sm:grid-cols-2">
            <input type="hidden" name="section" value="bank" />
            <Field name="bankName" label="Bank" defaultValue={s.bank.bankName} />
            <Field name="branch" label="Branch" defaultValue={s.bank.branch} />
            <Field name="accountName" label="Account name" defaultValue={s.bank.accountName} />
            <Field name="accountNumber" label="Account number" defaultValue={s.bank.accountNumber} />
            <Field name="swift" label="SWIFT code" defaultValue={s.bank.swift} />
            <div className="sm:col-span-2"><SubmitButton>Save bank details</SubmitButton></div>
          </ActionForm>
        </Card>
      )}

      {tab === "billing" && (
        <Card>
          <ActionForm action={saveSettingsAction} className="grid gap-4 sm:grid-cols-2">
            <input type="hidden" name="section" value="billing" />
            <Select name="defaultCurrency" label="Default currency" defaultValue={s.defaultCurrency} options={[{ value: "LKR", label: "LKR" }, { value: "USD", label: "USD" }]} />
            <div className="space-y-2 pt-6">
              <Checkbox name="currency_LKR" label="Allow LKR" defaultChecked={s.currencies.includes("LKR")} />
              <Checkbox name="currency_USD" label="Allow USD" defaultChecked={s.currencies.includes("USD")} />
            </div>
            <Field name="taxLabel" label="Default tax label" defaultValue={s.tax.label} />
            <Field name="taxRate" label="Default tax rate (%)" defaultValue={formatRate(s.tax.rateBp).replace("%", "")} hint="0 means no tax. Can be changed on each invoice." />
            <Field name="defaultPaymentTermsDays" label="Default payment terms (days)" type="number" defaultValue={s.defaultPaymentTermsDays} />
            <Field name="emailDailyLimit" label="Daily email limit" type="number" defaultValue={s.emailDailyLimit} hint="Stay under your Gmail account's daily sending limit." />
            <Field name="invoicePrefix" label="Invoice number prefix" defaultValue={s.numbering.invoicePrefix} hint="Numbers look like 10X-INV-2026-0001" />
            <Field name="proposalPrefix" label="Proposal reference prefix" defaultValue={s.numbering.proposalPrefix} hint="References look like 10X-PRO-2026-001" />
            <TextArea name="invoiceNotes" label="Default invoice notes" defaultValue={s.invoiceNotes} />
            <Field name="invoiceThankYou" label="Thank-you line" defaultValue={s.invoiceThankYou} />
            <div className="sm:col-span-2"><SubmitButton>Save</SubmitButton></div>
          </ActionForm>
        </Card>
      )}

      {tab === "reminders" && (
        <Card>
          <ActionForm action={saveSettingsAction} className="max-w-xl space-y-4">
            <input type="hidden" name="section" value="reminders" />
            <Field name="reminderOffsets" label="Reminder days" defaultValue={s.reminderOffsets.join(", ")}
              hint="Days relative to the due date: -3 is three days before, 0 is the due date, 7 is seven days overdue. After the last step the invoice is flagged for personal follow-up. Companies can override this on their page; invoices can switch reminders off." />
            <SubmitButton>Save reminder schedule</SubmitButton>
          </ActionForm>
        </Card>
      )}

      {tab === "emails" && preview && (
        <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
          <nav className="rounded-lg border border-line bg-white p-2" aria-label="Templates">
            {Object.keys(s.emailTemplates).map((k) => (
              <Link key={k} href={`/admin/settings?tab=emails&t=${k}`} className={cx("block rounded px-3 py-1.5 text-sm", k === tplKey ? "bg-brand-soft font-medium text-brand" : "hover:bg-zinc-50")}>{EMAIL_TEMPLATE_LABELS[k] ?? k}</Link>
            ))}
          </nav>
          <div className="min-w-0 space-y-4">
            <Card title={EMAIL_TEMPLATE_LABELS[tplKey] ?? tplKey} actions={<ActionButton action={testTemplateAction} fields={{ key: tplKey }}>Send test to me</ActionButton>}>
              <ActionForm action={saveSettingsAction} className="space-y-4" key={tplKey}>
                <input type="hidden" name="section" value="template" />
                <input type="hidden" name="key" value={tplKey} />
                <Field name="subject" label="Subject" defaultValue={tpl.subject} />
                <TextArea name="body" label="Message" rows={9} defaultValue={tpl.body} hint="Leave a blank line between paragraphs. Variables: {{client_name}}, {{company_name}}, {{invoice_number}}, {{amount_due}}, {{due_date}}, {{portal_link}} and others shown in the default text." />
                <Field name="buttonLabel" label="Button label" defaultValue={tpl.buttonLabel} />
                <SubmitButton>Save template</SubmitButton>
              </ActionForm>
            </Card>
            <Card title={`Preview: ${preview.subject}`}>
              <DocFrame html={preview.html} title="Email preview" />
              <details className="mt-3 text-sm"><summary className="cursor-pointer text-muted">Plain-text version</summary><pre className="mt-2 whitespace-pre-wrap rounded bg-zinc-50 p-3 text-xs">{preview.text}</pre></details>
            </Card>
          </div>
        </div>
      )}

      {tab === "texts" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title={editingBlock ? "Edit text block" : "New text block"}>
            <ActionForm action={saveTextBlockAction} className="space-y-3" key={editingBlock?._id.toHexString() ?? "new"} resetOnSuccess={!editingBlock}>
              {editingBlock && <input type="hidden" name="id" value={editingBlock._id.toHexString()} />}
              <Field name="title" label="Title" defaultValue={editingBlock?.title} placeholder="e.g. Standard terms" />
              <Field name="category" label="Category" defaultValue={editingBlock?.category ?? "General"} placeholder="e.g. Terms, Services" />
              <TextArea name="body" label="Text" rows={10} defaultValue={editingBlock?.body} hint="Supports **bold**, - lists, 1. numbered lists and [links](https://…)." />
              <SubmitButton>Save text block</SubmitButton>
            </ActionForm>
            <p className="mt-4 text-xs text-muted">Templates available when starting a proposal: {Object.values(PROPOSAL_TEMPLATES).map((t) => t.label).join(", ")}. The default terms are marked as a draft for review with a lawyer.</p>
          </Card>
          <Card title="Saved text blocks">
            {blocks.length === 0 ? <p className="text-sm text-muted">Save standard terms or service descriptions here to insert them into proposals.</p> : (
              <ul className="divide-y divide-line">
                {blocks.map((b) => (
                  <li key={b._id.toHexString()} className="flex items-center justify-between gap-2 py-2 text-sm">
                    <span><span className="text-xs text-muted">{b.category}</span><br /><Link href={`/admin/settings?tab=texts&block=${b._id}`} className="font-medium hover:text-brand">{b.title}</Link></span>
                    <ActionButton action={deleteTextBlockAction} fields={{ id: b._id.toHexString() }} variant="ghost" confirm={{ title: "Delete this text block?", summary: "Proposals that already used it keep their text." }}>Delete</ActionButton>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
