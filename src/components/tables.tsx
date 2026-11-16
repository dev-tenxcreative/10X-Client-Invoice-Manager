import Link from "next/link";
import { Money, StatusBadge, Table, Td, Th } from "./ui";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { displayStatus } from "@/lib/invoice-status";
import { METHOD_LABEL } from "@/lib/services/payments";
import type { InvoiceDoc, PaymentDoc, ProposalDoc } from "@/lib/types";

export function InvoiceTable({ invoices, hrefBase, companyNames, today, showTotals = true, pendingSlips }: {
  invoices: InvoiceDoc[];
  hrefBase: string;
  companyNames?: Map<string, string>;
  today: string;
  showTotals?: boolean;
  pendingSlips?: Set<string>;
}) {
  const totals: Record<string, { total: number; paid: number; balance: number }> = {};
  for (const i of invoices) {
    if (i.status === "void" || i.status === "draft") continue;
    const t = (totals[i.currency] ??= { total: 0, paid: 0, balance: 0 });
    t.total += i.total;
    t.paid += i.paidTotal;
    t.balance += i.balance;
  }
  return (
    <Table>
      <thead>
        <tr>
          <Th>Number</Th>
          {companyNames && <Th>Company</Th>}
          <Th>Issue date</Th>
          <Th>Due date</Th>
          <Th right>Total</Th>
          <Th right>Paid</Th>
          <Th right>Balance</Th>
          <Th>Status</Th>
        </tr>
      </thead>
      <tbody>
        {invoices.map((i) => (
          <tr key={i._id.toHexString()} className="hover:bg-zinc-50">
            <Td>
              <Link href={`${hrefBase}/${i._id}`} className="whitespace-nowrap font-semibold text-ink hover:text-brand">{i.number}</Link>
              {i.billingPeriod && <div className="text-xs text-muted">{i.billingPeriod}</div>}
              {i.source === "uploaded" && <div className="text-xs text-muted">Uploaded PDF</div>}
            </Td>
            {companyNames && <Td>{companyNames.get(i.companyId.toHexString())}</Td>}
            <Td className="num">{formatDate(i.issueDate)}</Td>
            <Td className="num">{formatDate(i.dueDate)}</Td>
            <Td right><Money amount={i.total} currency={i.currency} /></Td>
            <Td right><Money amount={i.paidTotal} currency={i.currency} /></Td>
            <Td right className="font-semibold"><Money amount={i.balance} currency={i.currency} /></Td>
            <Td>
              <StatusBadge status={displayStatus(i, today)} />
              {pendingSlips?.has(i._id.toHexString()) && <div className="mt-1 text-xs text-amber-700">Payment submitted</div>}
              {i.followUp && <div className="mt-1 text-xs text-brand">Follow up</div>}
            </Td>
          </tr>
        ))}
      </tbody>
      {showTotals && Object.keys(totals).length > 0 && (
        <tfoot>
          {Object.entries(totals).map(([cur, t]) => (
            <tr key={cur} className="bg-zinc-50 font-semibold">
              <Td colSpan={companyNames ? 4 : 3}>Total ({cur})</Td>
              <Td right>{formatMoney(t.total, cur)}</Td>
              <Td right>{formatMoney(t.paid, cur)}</Td>
              <Td right>{formatMoney(t.balance, cur)}</Td>
              <Td />
            </tr>
          ))}
        </tfoot>
      )}
    </Table>
  );
}

export function ProposalTable({ proposals, hrefBase, companyNames }: { proposals: ProposalDoc[]; hrefBase: string; companyNames?: Map<string, string> }) {
  return (
    <Table>
      <thead>
        <tr><Th>Reference</Th><Th>Title</Th>{companyNames && <Th>Company</Th>}<Th>Date</Th><Th>Valid until</Th><Th right>Total</Th><Th>Status</Th></tr>
      </thead>
      <tbody>
        {proposals.map((p) => (
          <tr key={p._id.toHexString()} className="hover:bg-zinc-50">
            <Td><Link href={`${hrefBase}/${p._id}`} className="whitespace-nowrap font-semibold text-ink hover:text-brand">{p.reference}</Link>{p.version > 1 && <div className="text-xs text-muted">Version {p.version}</div>}</Td>
            <Td>{p.content.title}</Td>
            {companyNames && <Td>{companyNames.get(p.companyId.toHexString())}</Td>}
            <Td className="num">{formatDate(p.content.date)}</Td>
            <Td className="num">{formatDate(p.content.validUntil)}</Td>
            <Td right><Money amount={p.total} currency={p.content.currency} /></Td>
            <Td><StatusBadge status={p.status} /></Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

export function PaymentTable({ payments, invoiceNumbers, invoiceHref, companyNames }: { payments: PaymentDoc[]; invoiceNumbers: Map<string, string>; invoiceHref: string; companyNames?: Map<string, string> }) {
  return (
    <Table>
      <thead><tr><Th>Date</Th><Th>Invoice</Th>{companyNames && <Th>Company</Th>}<Th>Method</Th><Th>Reference</Th><Th right>Amount</Th><Th>Receipt</Th></tr></thead>
      <tbody>
        {payments.map((p) => (
          <tr key={p._id.toHexString()}>
            <Td className="num">{formatDate(p.date)}</Td>
            <Td><Link href={`${invoiceHref}/${p.invoiceId}`} className="font-medium hover:text-brand">{invoiceNumbers.get(p.invoiceId.toHexString())}</Link></Td>
            {companyNames && <Td>{companyNames.get(p.companyId.toHexString())}</Td>}
            <Td>{METHOD_LABEL[p.method]}</Td>
            <Td>{p.reference}</Td>
            <Td right><Money amount={p.amount} currency={p.currency} /></Td>
            <Td>{p.fileId ? <a href={`/api/files/${p.fileId}`} className="text-brand hover:underline">View</a> : ""}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
