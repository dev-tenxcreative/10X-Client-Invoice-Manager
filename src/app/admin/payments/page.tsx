import Link from "next/link";
import { EmptyState, Money, PageHeader, StatusBadge, Table, Tabs, Td, Th } from "@/components/ui";
import { PaymentTable } from "@/components/tables";
import { ActionButton, ActionForm, Field, SubmitButton } from "@/components/client/action-form";
import { reviewSlipAction } from "@/app/actions/admin";
import { cols } from "@/lib/db";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { t } from "@/lib/i18n";

export const metadata = { title: "Payments" };

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const sp = await searchParams;
  const tab = sp.tab === "slips" ? "slips" : sp.tab === "reviewed" ? "reviewed" : "payments";
  const c = await cols();
  const [payments, pendingSlips, reviewed, companies] = await Promise.all([
    c.payments.find().sort({ date: -1, createdAt: -1 }).limit(300).toArray(),
    c.paymentSubmissions.find({ status: "pending" }).sort({ createdAt: 1 }).toArray(),
    c.paymentSubmissions.find({ status: { $ne: "pending" } }).sort({ reviewedAt: -1 }).limit(100).toArray(),
    c.companies.find({}, { projection: { name: 1 } }).toArray(),
  ]);
  const invIds = [...payments.map((p) => p.invoiceId), ...pendingSlips.map((s) => s.invoiceId), ...reviewed.map((s) => s.invoiceId)];
  const invoices = await c.invoices.find({ _id: { $in: invIds } }, { projection: { number: 1, balance: 1, currency: 1 } }).toArray();
  const numbers = new Map(invoices.map((i) => [i._id.toHexString(), i.number]));
  const names = new Map(companies.map((co) => [co._id.toHexString(), co.name]));

  return (
    <>
      <PageHeader title="Payments" description="Payments recorded by your team and bank slips uploaded by clients." />
      <Tabs current={tab} tabs={[
        { key: "payments", label: "Recorded payments", href: "/admin/payments" },
        { key: "slips", label: "Slips to confirm", href: "/admin/payments?tab=slips", count: pendingSlips.length },
        { key: "reviewed", label: "Reviewed slips", href: "/admin/payments?tab=reviewed" },
      ]} />
      {tab === "payments" && (payments.length ? <PaymentTable payments={payments} invoiceNumbers={numbers} invoiceHref="/admin/invoices" companyNames={names} /> : <EmptyState title="No payments yet" text={t.empty.payments} />)}
      {tab === "slips" && (pendingSlips.length === 0 ? <EmptyState title="No slips waiting" text="When a client uploads a bank slip, it appears here for you to confirm or reject." /> : (
        <div className="grid gap-4 md:grid-cols-2">
          {pendingSlips.map((s) => {
            const inv = invoices.find((i) => i._id.equals(s.invoiceId));
            return (
              <div key={s._id.toHexString()} className="rounded-lg border border-line bg-white p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <Link href={`/admin/invoices/${s.invoiceId}`} className="font-semibold hover:text-brand">{numbers.get(s.invoiceId.toHexString())}</Link>
                    <div className="text-sm text-muted">{names.get(s.companyId.toHexString())}</div>
                  </div>
                  <Money amount={s.amount} currency={s.currency} className="text-lg font-bold" />
                </div>
                <p className="mt-2 text-sm text-muted">Paid {formatDate(s.date)}{s.reference ? ` · Ref ${s.reference}` : ""} · uploaded {formatDateTime(s.createdAt)}{inv ? ` · balance ${formatMoney(inv.balance, inv.currency)}` : ""}</p>
                <a href={`/api/files/${s.fileId}`} target="_blank" className="mt-2 inline-block text-sm font-medium text-brand hover:underline">Open the slip</a>
                <div className="mt-4 flex flex-col gap-3">
                  <ActionButton action={reviewSlipAction} fields={{ id: s._id.toHexString(), op: "confirm" }} variant="primary" confirm={{ title: "Confirm this payment?", summary: `${formatMoney(s.amount, s.currency)} will be recorded against ${numbers.get(s.invoiceId.toHexString())}.` }}>Confirm payment</ActionButton>
                  <ActionForm action={reviewSlipAction} className="flex flex-col gap-2 sm:flex-row sm:items-end" confirm={{ title: "Reject this slip?", summary: "The client will be emailed with your reason." }}>
                    <input type="hidden" name="id" value={s._id.toHexString()} />
                    <input type="hidden" name="op" value="reject" />
                    <Field name="reason" label="Reason for rejecting" className="flex-1" />
                    <SubmitButton variant="danger">Reject</SubmitButton>
                  </ActionForm>
                </div>
              </div>
            );
          })}
        </div>
      ))}
      {tab === "reviewed" && (reviewed.length === 0 ? <EmptyState title="Nothing reviewed yet" text="Confirmed and rejected slips are listed here." /> : (
        <Table>
          <thead><tr><Th>Invoice</Th><Th>Company</Th><Th right>Amount</Th><Th>Reviewed</Th><Th>Result</Th></tr></thead>
          <tbody>{reviewed.map((s) => (
            <tr key={s._id.toHexString()}><Td><Link href={`/admin/invoices/${s.invoiceId}`} className="hover:text-brand">{numbers.get(s.invoiceId.toHexString())}</Link></Td><Td>{names.get(s.companyId.toHexString())}</Td><Td right><Money amount={s.amount} currency={s.currency} /></Td><Td>{formatDateTime(s.reviewedAt)}</Td><Td><StatusBadge status={s.status} />{s.rejectReason && <div className="text-xs text-muted">{s.rejectReason}</div>}</Td></tr>
          ))}</tbody>
        </Table>
      ))}
    </>
  );
}
