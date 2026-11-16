import { notFound } from "next/navigation";
import { ObjectId } from "mongodb";
import { Card, DL, Money, PageHeader, StatusBadge, buttonClass } from "@/components/ui";
import { ActionForm, Field, FileField, SubmitButton } from "@/components/client/action-form";
import { DocFrame } from "@/components/client/doc-frame";
import { submitSlipAction } from "@/app/actions/portal";
import { getPortalContext } from "@/lib/auth/session";
import { cols } from "@/lib/db";
import { canAccessCompany } from "@/lib/permissions";
import { displayStatus } from "@/lib/invoice-status";
import { invoiceDocData, markViewed } from "@/lib/services/invoices";
import { invoicePayments, METHOD_LABEL } from "@/lib/services/payments";
import { forScreen, renderInvoiceHtml } from "@/lib/documents/invoice-html";
import { formatDate, today } from "@/lib/dates";
import { formatMoney, minorToInput } from "@/lib/money";
import { t } from "@/lib/i18n";

export const metadata = { title: "Invoice" };

export default async function PortalInvoice({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getPortalContext();
  if (!ObjectId.isValid(id)) notFound();
  const c = await cols();
  const inv = await c.invoices.findOne({ _id: new ObjectId(id) });
  // Another company's invoice looks exactly like a missing one.
  if (!inv || inv.status === "draft" || !canAccessCompany(ctx, inv.companyId)) notFound();
  if (!ctx.readOnly && inv.status === "sent") {
    await markViewed(inv._id);
    inv.status = "viewed";
  }
  const td = today();
  const [data, { payments, submissions }] = await Promise.all([invoiceDocData(inv), invoicePayments(inv._id)]);
  const html = inv.source === "generated" ? forScreen(renderInvoiceHtml(data)) : null;
  const pending = submissions.filter((s) => s.status === "pending");
  const rejected = submissions.filter((s) => s.status === "rejected").slice(0, 1);
  const canPay = ["sent", "viewed", "partially_paid"].includes(inv.status) && inv.balance > 0;

  return (
    <>
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-3">Invoice {inv.number} <StatusBadge status={displayStatus(inv, td)} /></span>}
        description={`Due ${formatDate(inv.dueDate)}`}
        back={{ href: "/portal/invoices", label: "Invoices" }}
        actions={<a href={`/api/invoices/${id}/pdf`} className={buttonClass("primary")}>Download PDF</a>}
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          {html ? <DocFrame html={html} title={`Invoice ${inv.number}`} /> : (
            <Card>
              <DL items={[["Invoice", inv.number], ["Issue date", formatDate(inv.issueDate)], ["Due date", formatDate(inv.dueDate)], ["Total", formatMoney(inv.total, inv.currency)], ["Description", inv.description]]} />
              <a href={`/api/invoices/${id}/pdf`} className="mt-4 inline-block font-medium text-brand hover:underline">Download the invoice PDF</a>
            </Card>
          )}
        </div>
        <aside className="space-y-4">
          <Card title="Amounts">
            <DL items={[["Total", <Money key="t" amount={inv.total} currency={inv.currency} />], ["Paid", <Money key="p" amount={inv.paidTotal} currency={inv.currency} />], ["Balance due", <strong key="b" className="text-brand"><Money amount={inv.balance} currency={inv.currency} /></strong>]]} />
          </Card>
          {pending.length > 0 && <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{t.client.awaiting}: {pending.map((s) => formatMoney(s.amount, s.currency)).join(", ")}</div>}
          {rejected.length > 0 && pending.length === 0 && <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">Your last payment slip could not be confirmed: {rejected[0].rejectReason}</div>}
          {canPay && !ctx.readOnly && pending.length === 0 && (
            <Card title={t.client.uploadSlip}>
              <div id="pay" />
              <p className="mb-3 text-sm text-muted">Paid by bank transfer? Upload the slip and we will confirm it. Please use <strong>{inv.number}</strong> as your payment reference.</p>
              <ActionForm action={submitSlipAction} resetOnSuccess className="space-y-3"
                confirm={{ title: "Submit this payment slip?", summary: `We will check the slip and confirm the payment for invoice ${inv.number}.`, confirmLabel: "Submit" }}>
                <input type="hidden" name="invoiceId" value={id} />
                <Field name="amount" label={`Amount paid (${inv.currency})`} inputMode="decimal" defaultValue={minorToInput(inv.balance, inv.currency)} />
                <Field name="date" label="Date paid" type="date" defaultValue={td} max={td} />
                <Field name="reference" label="Bank reference (optional)" />
                <FileField name="file" label="Payment slip" required />
                <SubmitButton pendingText="Uploading…">Submit payment slip</SubmitButton>
              </ActionForm>
            </Card>
          )}
          <Card title="Payment history">
            {payments.length === 0 ? <p className="text-sm text-muted">No payments recorded yet.</p> : (
              <ul className="divide-y divide-line text-sm">
                {payments.map((p) => <li key={p._id.toHexString()} className="flex justify-between gap-2 py-2"><span>{formatDate(p.date)} · {METHOD_LABEL[p.method]}</span><Money amount={p.amount} currency={p.currency} className="font-semibold" /></li>)}
              </ul>
            )}
          </Card>
        </aside>
      </div>
    </>
  );
}
