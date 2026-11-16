import Link from "next/link";
import { notFound } from "next/navigation";
import { ObjectId } from "mongodb";
import { Card, DL, LinkButton, Money, PageHeader, StatusBadge, Table, Td, Th, buttonClass } from "@/components/ui";
import { ActionButton, ActionForm, Field, FileField, Select, SubmitButton, TextArea } from "@/components/client/action-form";
import { DocFrame } from "@/components/client/doc-frame";
import { discardDraftAction, duplicateInvoiceAction, invoiceRemindersAction, recordPaymentAction, reviewSlipAction, sendInvoiceAction, voidInvoiceAction } from "@/app/actions/admin";
import { cols } from "@/lib/db";
import { displayStatus } from "@/lib/invoice-status";
import { invoiceDocData } from "@/lib/services/invoices";
import { invoicePayments, METHOD_LABEL } from "@/lib/services/payments";
import { forScreen, renderInvoiceHtml } from "@/lib/documents/invoice-html";
import { formatDate, formatDateTime, today } from "@/lib/dates";
import { formatMoney, minorToInput } from "@/lib/money";

export const metadata = { title: "Invoice" };

export default async function AdminInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!ObjectId.isValid(id)) notFound();
  const c = await cols();
  const inv = await c.invoices.findOne({ _id: new ObjectId(id) });
  if (!inv) notFound();
  const t = today();
  const [data, { payments, submissions }, reminders, emails, plan, proposal, replaced] = await Promise.all([
    invoiceDocData(inv),
    invoicePayments(inv._id),
    c.reminderLogs.find({ invoiceId: inv._id }).sort({ sentAt: 1 }).toArray(),
    c.emailLogs.find({ "related.id": inv._id }).sort({ createdAt: -1 }).limit(20).toArray(),
    inv.planId ? c.recurringPlans.findOne({ _id: inv.planId }) : null,
    inv.proposalId ? c.proposals.findOne({ _id: inv.proposalId }) : null,
    inv.replacesInvoiceId ? c.invoices.findOne({ _id: inv.replacesInvoiceId }) : null,
  ]);
  const status = displayStatus(inv, t);
  const html = inv.source === "generated" ? forScreen(renderInvoiceHtml(data)) : null;
  const pending = submissions.filter((s) => s.status === "pending");
  const canPay = ["sent", "viewed", "partially_paid"].includes(inv.status) && inv.balance > 0;

  return (
    <>
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-3">{inv.number} <StatusBadge status={status} /></span>}
        description={<>For <Link href={`/admin/companies/${data.company._id}`} className="font-medium text-ink hover:text-brand">{data.company.name}</Link> · Due {formatDate(inv.dueDate)}</>}
        back={{ href: "/admin/invoices", label: "Invoices" }}
        actions={
          <>
            <a href={`/api/invoices/${id}/pdf`} className={buttonClass("secondary")}>Download PDF</a>
            {inv.status === "draft" && inv.source === "generated" && <LinkButton href={`/admin/invoices/${id}/edit`} variant="secondary">Edit draft</LinkButton>}
            {inv.status === "draft" && (
              <ActionButton action={sendInvoiceAction} fields={{ id }} variant="primary"
                confirm={{ title: "Send this invoice?", summary: <>Invoice <strong>{inv.number}</strong> for <strong>{formatMoney(inv.total, inv.currency)}</strong>, due {formatDate(inv.dueDate)}, will be emailed with the PDF to {data.company.name}. It will then be locked.</>, confirmLabel: "Send invoice" }}>
                Send invoice
              </ActionButton>
            )}
            {inv.status !== "draft" && inv.status !== "void" && (
              <ActionButton action={sendInvoiceAction} fields={{ id }} confirm={{ title: "Resend this invoice?", summary: `${inv.number} will be emailed again to ${data.company.name}'s contacts.`, confirmLabel: "Resend" }}>Resend</ActionButton>
            )}
          </>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-4">
          {pending.length > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">Payment submitted by the client, awaiting your confirmation (see the right panel).</div>
          )}
          {inv.followUp && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
              <span>All reminders have been sent and this invoice is still unpaid. Please follow up personally.</span>
              <ActionButton action={invoiceRemindersAction} fields={{ id, op: "clearFollowUp" }} variant="ghost">Mark as followed up</ActionButton>
            </div>
          )}
          {html ? <DocFrame html={html} title={`Invoice ${inv.number}`} /> : (
            <Card title="Uploaded invoice">
              <DL items={[["Number", inv.number], ["Issue date", formatDate(inv.issueDate)], ["Due date", formatDate(inv.dueDate)], ["Total", formatMoney(inv.total, inv.currency)], ["Description", inv.description]]} />
              <object data={`/api/invoices/${id}/pdf?inline=1`} type="application/pdf" className="mt-4 h-[900px] w-full rounded border border-line">
                <a href={`/api/invoices/${id}/pdf`} className="text-brand underline">Download the PDF</a>
              </object>
            </Card>
          )}
        </div>

        <aside className="space-y-4">
          <Card title="Summary">
            <DL items={[
              ["Total", <Money key="t" amount={inv.total} currency={inv.currency} />],
              ["Paid", <Money key="p" amount={inv.paidTotal} currency={inv.currency} />],
              ["Balance", <strong key="b"><Money amount={inv.balance} currency={inv.currency} /></strong>],
              ["Sent", inv.sentAt ? formatDateTime(inv.sentAt) : "Not yet"],
              ["Viewed by client", inv.viewedAt ? formatDateTime(inv.viewedAt) : ""],
              ["Recurring plan", plan ? <Link key="pl" href={`/admin/plans/${plan._id}`} className="text-brand hover:underline">{plan.name}</Link> : ""],
              ["From proposal", proposal ? <Link key="pr" href={`/admin/proposals/${proposal._id}`} className="text-brand hover:underline">{proposal.reference}</Link> : ""],
              ["Replaces", replaced ? <Link key="rp" href={`/admin/invoices/${replaced._id}`} className="text-brand hover:underline">{replaced.number}</Link> : ""],
              ["Void reason", inv.voidReason],
            ]} />
          </Card>

          {pending.map((s) => (
            <Card key={s._id.toHexString()} title="Payment slip to review">
              <DL items={[["Amount", formatMoney(s.amount, s.currency)], ["Paid on", formatDate(s.date)], ["Reference", s.reference], ["Uploaded", formatDateTime(s.createdAt)]]} />
              <a href={`/api/files/${s.fileId}`} target="_blank" className="mt-3 inline-block text-sm font-medium text-brand hover:underline">Open the slip</a>
              <div className="mt-4 space-y-3">
                <ActionButton action={reviewSlipAction} fields={{ id: s._id.toHexString(), op: "confirm" }} variant="primary"
                  confirm={{ title: "Confirm this payment?", summary: `${formatMoney(s.amount, s.currency)} will be recorded against ${inv.number}. The client will be emailed.`, confirmLabel: "Confirm payment" }}>
                  Confirm payment
                </ActionButton>
                <ActionForm action={reviewSlipAction} className="space-y-2" confirm={{ title: "Reject this slip?", summary: "The client will be emailed with your reason." }}>
                  <input type="hidden" name="id" value={s._id.toHexString()} />
                  <input type="hidden" name="op" value="reject" />
                  <Field name="reason" label="Reason for rejecting" placeholder="e.g. The amount does not match our bank statement" />
                  <SubmitButton variant="danger">Reject</SubmitButton>
                </ActionForm>
              </div>
            </Card>
          ))}

          {canPay && (
            <Card title="Record a payment">
              <ActionForm action={recordPaymentAction} resetOnSuccess className="space-y-3"
                confirm={{ title: "Record this payment?", summary: `The payment will be added to ${inv.number}. Current balance: ${formatMoney(inv.balance, inv.currency)}. The client will be emailed.` }}>
                <input type="hidden" name="invoiceId" value={id} />
                <div className="grid grid-cols-2 gap-3">
                  <Field name="date" label="Date" type="date" defaultValue={t} />
                  <Field name="amount" label={`Amount (${inv.currency})`} inputMode="decimal" defaultValue={minorToInput(inv.balance, inv.currency)} />
                </div>
                <Select name="method" label="Method" options={Object.entries(METHOD_LABEL).map(([value, label]) => ({ value, label }))} />
                <Field name="reference" label="Reference" />
                <TextArea name="note" label="Note" rows={2} />
                <FileField name="file" label="Receipt (optional)" />
                <SubmitButton>Record payment</SubmitButton>
              </ActionForm>
            </Card>
          )}

          <Card title="Reminders">
            <p className="text-sm text-muted">{inv.remindersEnabled ? "Reminders are on for this invoice." : "Reminders are off for this invoice."}</p>
            {reminders.length > 0 && (
              <ul className="mt-2 space-y-1 text-sm">
                {reminders.map((r) => <li key={r._id.toHexString()}>{r.step < 0 ? `${-r.step} days before due` : r.step === 0 ? "On the due date" : `${r.step} days overdue`} · <span className="text-muted">{formatDateTime(r.sentAt)}</span></li>)}
              </ul>
            )}
            {inv.status !== "void" && inv.status !== "paid" && (
              <div className="mt-3"><ActionButton action={invoiceRemindersAction} fields={{ id, enabled: inv.remindersEnabled ? "0" : "1" }}>{inv.remindersEnabled ? "Turn reminders off" : "Turn reminders on"}</ActionButton></div>
            )}
          </Card>

          <Card title="More actions">
            <div className="space-y-4">
              {inv.status === "draft" ? (
                <ActionButton action={discardDraftAction} fields={{ id }} variant="danger" confirm={{ title: "Discard this draft?", summary: `${inv.number} will be marked void. Invoice numbers are never reused.`, danger: true }}>Discard draft</ActionButton>
              ) : inv.status !== "void" ? (
                <ActionForm action={voidInvoiceAction} className="space-y-2" confirm={{ title: "Void this invoice?", summary: `${inv.number} (${formatMoney(inv.total, inv.currency)}) will be marked void and stop counting in totals and reminders. This cannot be undone.`, danger: true, confirmLabel: "Void invoice" }}>
                  <input type="hidden" name="id" value={id} />
                  <Field name="reason" label="Reason for voiding" placeholder="e.g. Wrong amount; replaced by a new invoice" />
                  <SubmitButton variant="danger">Void invoice</SubmitButton>
                </ActionForm>
              ) : null}
              {inv.source === "generated" && <ActionButton action={duplicateInvoiceAction} fields={{ id }}>{inv.status === "void" ? "Issue a corrected copy" : "Duplicate as new draft"}</ActionButton>}
            </div>
          </Card>
        </aside>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card title="Payments">
          {payments.length === 0 ? <p className="text-sm text-muted">No payments recorded yet.</p> : (
            <Table>
              <thead><tr><Th>Date</Th><Th>Method</Th><Th>Reference</Th><Th right>Amount</Th></tr></thead>
              <tbody>{payments.map((p) => (
                <tr key={p._id.toHexString()}><Td>{formatDate(p.date)}</Td><Td>{METHOD_LABEL[p.method]}{p.fileId && <> · <a className="text-brand hover:underline" href={`/api/files/${p.fileId}`}>file</a></>}</Td><Td>{p.reference}</Td><Td right><Money amount={p.amount} currency={p.currency} /></Td></tr>
              ))}</tbody>
            </Table>
          )}
          {submissions.filter((s) => s.status !== "pending").length > 0 && (
            <ul className="mt-3 space-y-1 text-xs text-muted">
              {submissions.filter((s) => s.status !== "pending").map((s) => <li key={s._id.toHexString()}>Slip {formatMoney(s.amount, s.currency)} · {s.status}{s.rejectReason ? `: ${s.rejectReason}` : ""}</li>)}
            </ul>
          )}
        </Card>
        <Card title="Emails" actions={<Link href="/admin/emails" className="text-sm text-brand hover:underline">Email log</Link>}>
          {emails.length === 0 ? <p className="text-sm text-muted">No emails sent for this invoice yet.</p> : (
            <ul className="divide-y divide-line text-sm">
              {emails.map((e) => <li key={e._id.toHexString()} className="flex items-start justify-between gap-2 py-2"><span>{e.subject}<div className="text-xs text-muted">{e.to.join(", ")} · {formatDateTime(e.createdAt)}</div></span><StatusBadge status={e.status} /></li>)}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
