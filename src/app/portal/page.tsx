import Link from "next/link";
import { Card, EmptyState, LinkButton, Money, MoneyList, PageHeader, Stat, StatusBadge } from "@/components/ui";
import { getPortalContext } from "@/lib/auth/session";
import { cols } from "@/lib/db";
import { companyInvoiceStats } from "@/lib/services/invoices";
import { displayStatus, OPEN_STATUSES } from "@/lib/invoice-status";
import { formatDate, formatDateTime, today } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { t } from "@/lib/i18n";

export const metadata = { title: "Dashboard" };

export default async function PortalHome() {
  const ctx = await getPortalContext();
  const c = await cols();
  const companyId = ctx.company._id;
  const td = today();
  const [invoices, proposals, slips, payments] = await Promise.all([
    c.invoices.find({ companyId, status: { $ne: "draft" } }).sort({ dueDate: 1 }).toArray(),
    c.proposals.find({ companyId, status: { $in: ["sent", "viewed"] } }).sort({ createdAt: -1 }).toArray(),
    c.paymentSubmissions.find({ companyId, status: "pending" }).toArray(),
    c.payments.find({ companyId }).sort({ date: -1 }).limit(5).toArray(),
  ]);
  const stats = companyInvoiceStats(invoices, td);
  const open = invoices.filter((i) => OPEN_STATUSES.includes(i.status) && i.balance > 0);
  const nextDue = open.filter((i) => i.dueDate >= td).sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
  const slipSet = new Set(slips.map((s) => s.invoiceId.toHexString()));
  const activity = [
    ...invoices.filter((i) => i.sentAt).map((i) => ({ at: i.sentAt!, text: `Invoice ${i.number} was issued`, href: `/portal/invoices/${i._id}` })),
    ...payments.map((p) => ({ at: p.createdAt, text: `Payment received: ${formatMoney(p.amount, p.currency)}`, href: `/portal/invoices/${p.invoiceId}` })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 6);

  return (
    <>
      <PageHeader title={`${t.client.welcome}, ${ctx.auth.user.name.split(" ")[0]}`} description={ctx.company.name} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label={t.client.outstanding}><MoneyList values={stats.outstanding} empty="Nothing to pay" /></Stat>
        <Stat label={t.client.overdue} tone="red"><MoneyList values={stats.overdue} empty="None" /></Stat>
        <Stat label={t.client.nextDue}>{nextDue ? formatDate(nextDue.dueDate) : "—"}</Stat>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card title={t.client.pendingInvoices}>
          {open.length === 0 ? <p className="text-sm text-muted">{t.client.allPaid}</p> : (
            <ul className="divide-y divide-line">
              {open.map((i) => (
                <li key={i._id.toHexString()} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{i.number}</span><StatusBadge status={displayStatus(i, td)} /></div>
                    <div className="text-sm text-muted">Due {formatDate(i.dueDate)} · Balance <Money amount={i.balance} currency={i.currency} className="font-semibold text-ink" /></div>
                    {slipSet.has(i._id.toHexString()) && <div className="text-xs text-amber-700">{t.client.awaiting}</div>}
                  </div>
                  <div className="flex gap-2">
                    <LinkButton href={`/portal/invoices/${i._id}`} variant="secondary">{t.client.view}</LinkButton>
                    {!ctx.readOnly && <LinkButton href={`/portal/invoices/${i._id}#pay`}>{t.client.uploadSlip}</LinkButton>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <div className="space-y-4">
          <Card title={t.client.proposalsWaiting}>
            {proposals.length === 0 ? <p className="text-sm text-muted">No proposals are waiting for you.</p> : (
              <ul className="space-y-2 text-sm">
                {proposals.map((p) => (
                  <li key={p._id.toHexString()}><Link href={`/portal/proposals/${p._id}`} className="font-semibold hover:text-brand">{p.content.title}</Link><div className="text-muted">{p.reference} · valid until {formatDate(p.content.validUntil)}</div></li>
                ))}
              </ul>
            )}
          </Card>
          <Card title={t.client.recentActivity}>
            {activity.length === 0 ? <p className="text-sm text-muted">Nothing yet.</p> : (
              <ul className="space-y-2 text-sm">{activity.map((a, i) => <li key={i}><Link href={a.href} className="hover:text-brand">{a.text}</Link><div className="text-xs text-muted">{formatDateTime(a.at)}</div></li>)}</ul>
            )}
          </Card>
        </div>
      </div>
      {invoices.length === 0 && proposals.length === 0 && (
        <div className="mt-6"><EmptyState title="Welcome to your portal" text="When 10X Creative sends you a proposal or an invoice, it will appear here. You can view, download and pay from one place." /></div>
      )}
    </>
  );
}
