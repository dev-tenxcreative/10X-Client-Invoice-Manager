import Link from "next/link";
import { notFound } from "next/navigation";
import { ObjectId } from "mongodb";
import { Card, DL, EmptyState, LinkButton, MoneyList, PageHeader, Stat, StatusBadge, Table, Tabs, Td, Th, Money } from "@/components/ui";
import { InvoiceTable, PaymentTable, ProposalTable } from "@/components/tables";
import { ActionButton, ActionForm, Checkbox, Field, Select, SubmitButton, TextArea } from "@/components/client/action-form";
import { addContactAction, archiveCompanyAction, unlinkContactAction, updateCompanyAction, userInviteAction } from "@/app/actions/admin";
import { viewAsClientAction } from "@/app/actions/auth";
import { cols } from "@/lib/db";
import { companyContacts } from "@/lib/services/companies";
import { companyInvoiceStats } from "@/lib/services/invoices";
import { planNext, planTotals } from "@/lib/services/plans";
import { getSettings } from "@/lib/services/settings";
import { formatDate, formatDateTime, today } from "@/lib/dates";

export const metadata = { title: "Company" };

const TABS = ["overview", "contacts", "proposals", "invoices", "plans", "payments", "files", "activity"] as const;
type Tab = (typeof TABS)[number];

export default async function CompanyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!ObjectId.isValid(id)) notFound();
  const c = await cols();
  const company = await c.companies.findOne({ _id: new ObjectId(id) });
  if (!company) notFound();
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as Tab) : "overview";
  const t = today();
  const [invoices, proposals, planList, payments, files, activity, contacts, settings] = await Promise.all([
    c.invoices.find({ companyId: company._id }).sort({ issueDate: -1 }).toArray(),
    c.proposals.find({ companyId: company._id }).sort({ createdAt: -1 }).toArray(),
    c.recurringPlans.find({ companyId: company._id }).sort({ createdAt: -1 }).toArray(),
    c.payments.find({ companyId: company._id }).sort({ date: -1 }).toArray(),
    c.files.find({ companyId: company._id, kind: { $nin: ["invoice_pdf", "proposal_pdf"] } }).sort({ createdAt: -1 }).toArray(),
    c.auditLogs.find({ $or: [{ entityId: company._id }, { entityId: { $in: [] } }] }).sort({ at: -1 }).limit(50).toArray(),
    companyContacts(company._id),
    getSettings(),
  ]);
  const stats = companyInvoiceStats(invoices, t);
  const base = `/admin/companies/${id}`;
  const invNumbers = new Map(invoices.map((i) => [i._id.toHexString(), i.number]));
  const relatedActivity = activity.length ? activity : [];
  const extraActivity = await c.auditLogs.find({ entityId: { $in: [...invoices.map((i) => i._id), ...proposals.map((p) => p._id), ...planList.map((p) => p._id)] } }).sort({ at: -1 }).limit(50).toArray();
  const allActivity = [...relatedActivity, ...extraActivity].sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 60);

  return (
    <>
      <PageHeader
        title={company.name}
        description={[company.billingAddress, company.city, company.country].filter(Boolean).join(", ")}
        back={{ href: "/admin/companies", label: "Clients" }}
        actions={
          <>
            <StatusBadge status={company.status} />
            <ActionButton action={viewAsClientAction} fields={{ companyId: id }} variant="secondary">View as client</ActionButton>
            <LinkButton href={`/admin/invoices/new?company=${id}`} variant="secondary">New invoice</LinkButton>
            <LinkButton href={`/admin/proposals/new?company=${id}`}>New proposal</LinkButton>
          </>
        }
      />
      <Tabs current={tab} tabs={[
        { key: "overview", label: "Overview", href: base },
        { key: "contacts", label: "Contacts", href: `${base}?tab=contacts`, count: contacts.length },
        { key: "proposals", label: "Proposals", href: `${base}?tab=proposals`, count: proposals.length },
        { key: "invoices", label: "Invoices", href: `${base}?tab=invoices`, count: invoices.length },
        { key: "plans", label: "Recurring plans", href: `${base}?tab=plans`, count: planList.length },
        { key: "payments", label: "Payments", href: `${base}?tab=payments`, count: payments.length },
        { key: "files", label: "Files", href: `${base}?tab=files`, count: files.length },
        { key: "activity", label: "Activity", href: `${base}?tab=activity` },
      ]} />

      {tab === "overview" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Outstanding"><MoneyList values={stats.outstanding} /></Stat>
            <Stat label="Overdue" tone="red"><MoneyList values={stats.overdue} /></Stat>
            <Stat label="Total billed"><MoneyList values={stats.billed} /></Stat>
            <Stat label="Total paid"><MoneyList values={stats.paid} /></Stat>
          </div>
          <Card title="Company details">
            <ActionForm action={updateCompanyAction} className="grid gap-4 sm:grid-cols-2">
              <input type="hidden" name="id" value={id} />
              <Field name="company.name" label="Company name" defaultValue={company.name} required className="sm:col-span-2" />
              <Field name="company.billingAddress" label="Billing address" defaultValue={company.billingAddress} required className="sm:col-span-2" />
              <Field name="company.city" label="City" defaultValue={company.city} required />
              <Field name="company.country" label="Country" defaultValue={company.country} required />
              <Field name="company.taxNumber" label="Registration or tax number" defaultValue={company.taxNumber} />
              <Field name="company.billingEmails" label="Extra billing emails (CC)" defaultValue={company.billingEmails.join(", ")} hint="Separate with commas" />
              <Select name="company.currency" label="Default currency" defaultValue={company.currency} options={[{ value: "LKR", label: "LKR" }, { value: "USD", label: "USD" }]} />
              <Field name="company.paymentTermsDays" label="Payment terms (days)" type="number" defaultValue={company.paymentTermsDays} />
              <Field name="reminderOffsets" label="Reminder schedule override" defaultValue={company.reminderOffsets?.join(", ") ?? ""} hint={`Days from the due date, e.g. -3, 0, 3, 7, 14. Leave empty to use Settings (${settings.reminderOffsets.join(", ")}).`} className="sm:col-span-2" />
              <TextArea name="company.notes" label="Internal notes" defaultValue={company.notes} className="sm:col-span-2" />
              <div className="flex flex-wrap gap-2 sm:col-span-2"><SubmitButton>Save changes</SubmitButton></div>
            </ActionForm>
          </Card>
          <Card title="Archive">
            <p className="mb-3 text-sm text-muted">Companies with documents are never deleted. Archiving hides the company from lists and pauses its plans. History stays available.</p>
            <ActionButton action={archiveCompanyAction} fields={{ id, archive: company.status === "archived" ? "0" : "1" }} variant="danger"
              confirm={{ title: company.status === "archived" ? "Restore this company?" : "Archive this company?", summary: company.status === "archived" ? `${company.name} will appear in lists again.` : `${company.name} will be hidden from lists and ${planList.filter((p) => p.status === "active").length} active plan(s) will be paused.`, danger: true }}>
              {company.status === "archived" ? "Restore company" : "Archive company"}
            </ActionButton>
          </Card>
        </div>
      )}

      {tab === "contacts" && (
        <div className="space-y-4">
          {contacts.length === 0 ? <EmptyState title="No contacts" text="Contacts can sign in to see this company's proposals and invoices." /> : (
            <Table>
              <thead><tr><Th>Name</Th><Th>Email</Th><Th>Phone</Th><Th>Status</Th><Th>Last sign-in</Th><Th>Actions</Th></tr></thead>
              <tbody>
                {contacts.map((u) => (
                  <tr key={u._id.toHexString()}>
                    <Td><div className="font-semibold">{u.name}{u.isPrimary && <span className="ml-2 text-xs text-muted">Primary</span>}</div><div className="text-xs text-muted">{u.designation}</div></Td>
                    <Td>{u.email}</Td>
                    <Td>{u.phone}</Td>
                    <Td><StatusBadge status={u.status} /></Td>
                    <Td className="text-xs text-muted">{u.lastSignInAt ? formatDateTime(u.lastSignInAt) : "Never"}</Td>
                    <Td>
                      <div className="flex flex-wrap gap-2">
                        {u.status === "invited" && <>
                          <ActionButton action={userInviteAction} fields={{ userId: u._id.toHexString(), op: "resend" }}>Resend invite</ActionButton>
                          <ActionButton action={userInviteAction} fields={{ userId: u._id.toHexString(), op: "cancel" }} variant="danger" confirm={{ title: "Cancel this invitation?", summary: `${u.email} will not be able to set up an account until you resend it.` }}>Cancel invite</ActionButton>
                        </>}
                        {u.status === "deactivated" && <ActionButton action={userInviteAction} fields={{ userId: u._id.toHexString(), op: u.passwordHash ? "reactivate" : "resend" }}>{u.passwordHash ? "Reactivate" : "Invite again"}</ActionButton>}
                        {u.status === "active" && <ActionButton action={userInviteAction} fields={{ userId: u._id.toHexString(), op: "deactivate" }} variant="danger" confirm={{ title: "Deactivate this contact?", summary: `${u.name} will be signed out and cannot sign in.`, danger: true }}>Deactivate</ActionButton>}
                        <ActionButton action={unlinkContactAction} fields={{ userId: u._id.toHexString(), companyId: id }} variant="ghost" confirm={{ title: "Remove from this company?", summary: `${u.name} will no longer see ${company.name}'s documents.` }}>Remove</ActionButton>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          <Card title="Add a contact">
            <ActionForm action={addContactAction} resetOnSuccess className="grid gap-4 sm:grid-cols-2">
              <input type="hidden" name="companyId" value={id} />
              <Field name="contact.name" label="Full name" required />
              <Field name="contact.email" label="Email" type="email" required hint="If this person already has an account, they will be linked to this company too." />
              <Field name="contact.phone" label="Phone" />
              <Field name="contact.designation" label="Designation" />
              <div className="flex flex-col gap-3 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between">
                <Checkbox name="sendInvite" label="Send invitation now" defaultChecked />
                <SubmitButton>Add contact</SubmitButton>
              </div>
            </ActionForm>
          </Card>
        </div>
      )}

      {tab === "proposals" && (proposals.length ? <ProposalTable proposals={proposals} hrefBase="/admin/proposals" /> : <EmptyState title="No proposals" text="Build a proposal from a template or upload a PDF." action={<LinkButton href={`/admin/proposals/new?company=${id}`}>New proposal</LinkButton>} />)}
      {tab === "invoices" && (invoices.length ? <InvoiceTable invoices={invoices} hrefBase="/admin/invoices" today={t} /> : <EmptyState title="No invoices" text="Create an invoice or upload one you already sent." action={<LinkButton href={`/admin/invoices/new?company=${id}`}>New invoice</LinkButton>} />)}
      {tab === "plans" && (planList.length ? (
        <Table>
          <thead><tr><Th>Plan</Th><Th>Billing day</Th><Th>Mode</Th><Th right>Amount</Th><Th>Next invoice</Th><Th>Status</Th></tr></thead>
          <tbody>{await Promise.all(planList.map(async (p) => { const n = await planNext(p); return (
            <tr key={p._id.toHexString()}><Td><Link href={`/admin/plans/${p._id}`} className="font-semibold hover:text-brand">{p.name}</Link></Td><Td>{p.billingDay}</Td><Td>{p.mode === "auto" ? "Send automatically" : "Draft for review"}</Td><Td right><Money amount={planTotals(p).total} currency={p.currency} /></Td><Td>{n.date ? formatDate(n.date) : "—"}</Td><Td><StatusBadge status={p.status} /></Td></tr>
          ); }))}</tbody>
        </Table>
      ) : <EmptyState title="No recurring plans" text="Use a plan for monthly retainers. It creates the invoice each month." action={<LinkButton href={`/admin/plans/new?company=${id}`}>New plan</LinkButton>} />)}
      {tab === "payments" && (payments.length ? <PaymentTable payments={payments} invoiceNumbers={invNumbers} invoiceHref="/admin/invoices" /> : <EmptyState title="No payments" text="Payments recorded against this company's invoices appear here." />)}
      {tab === "files" && (files.length ? (
        <Table>
          <thead><tr><Th>File</Th><Th>Type</Th><Th>Uploaded</Th><Th right>Size</Th></tr></thead>
          <tbody>{files.map((f) => (
            <tr key={f._id.toHexString()}><Td><a href={`/api/files/${f._id}`} className="font-medium text-brand hover:underline">{f.originalName}</a></Td><Td>{f.kind.replace(/_/g, " ")}</Td><Td>{formatDateTime(f.createdAt)}</Td><Td right>{(f.size / 1024).toFixed(0)} KB</Td></tr>
          ))}</tbody>
        </Table>
      ) : <EmptyState title="No files" text="Uploaded invoices, proposals, receipts and payment slips for this company appear here." />)}
      {tab === "activity" && (allActivity.length ? (
        <Table>
          <thead><tr><Th>When</Th><Th>Who</Th><Th>What</Th></tr></thead>
          <tbody>{allActivity.map((a) => (
            <tr key={a._id.toHexString()}><Td className="text-xs">{formatDateTime(a.at)}</Td><Td>{a.actorEmail}</Td><Td>{a.action.replace(/[._]/g, " ")}</Td></tr>
          ))}</tbody>
        </Table>
      ) : <EmptyState title="No activity yet" text="Changes to this company and its documents are recorded here." />)}
    </>
  );
}
