import Link from "next/link";
import { Card, MoneyList, PageHeader, Stat, StatusBadge, Money, LinkButton } from "@/components/ui";
import { adminDashboard } from "@/lib/services/reports";
import { planNext, planTotals } from "@/lib/services/plans";
import { addDays, formatDate, formatDateTime, today } from "@/lib/dates";
import { emailConfigured } from "@/lib/email";

export const metadata = { title: "Dashboard" };

export default async function AdminDashboard() {
  const d = await adminDashboard();
  const t = today();
  const upcoming = (
    await Promise.all(d.plans.map(async (p) => ({ plan: p, next: await planNext(p) })))
  ).filter((x) => x.next.date && x.next.date <= addDays(t, 7));

  return (
    <>
      <PageHeader title="Dashboard" description={`Today is ${formatDate(t)} (Colombo time).`} />
      {!emailConfigured() && (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Email is not configured yet. Add SMTP_USER and SMTP_PASS (Gmail App Password) to the environment, or emails will fail.
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Outstanding"><MoneyList values={d.outstanding} /></Stat>
        <Stat label="Overdue" tone="red"><MoneyList values={d.overdue} /></Stat>
        <Stat label="Due in next 7 days"><MoneyList values={d.dueSoon} /></Stat>
        <Stat label="Collected this month"><MoneyList values={d.collected} /></Stat>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card title="Needs your action">
          <ul className="divide-y divide-line text-sm">
            {d.slips.map((s) => (
              <li key={s._id.toHexString()} className="flex items-center justify-between gap-3 py-2">
                <span>Payment slip for <strong>{d.slipInvoices.find((i) => i._id.equals(s.invoiceId))?.number}</strong> · <Money amount={s.amount} currency={s.currency} /></span>
                <Link href="/admin/payments?tab=slips" className="font-medium text-brand hover:underline">Review</Link>
              </li>
            ))}
            {d.drafts.map((i) => (
              <li key={i._id.toHexString()} className="flex items-center justify-between gap-3 py-2">
                <span>Draft <strong>{i.number}</strong> for {d.companyName.get(i.companyId.toHexString())} · <Money amount={i.total} currency={i.currency} /></span>
                <Link href={`/admin/invoices/${i._id}`} className="font-medium text-brand hover:underline">Review</Link>
              </li>
            ))}
            {d.followUps.map((i) => (
              <li key={`f${i._id}`} className="flex items-center justify-between gap-3 py-2">
                <span>Follow up: <strong>{i.number}</strong> ({d.companyName.get(i.companyId.toHexString())}) is still unpaid after all reminders</span>
                <Link href={`/admin/invoices/${i._id}`} className="font-medium text-brand hover:underline">Open</Link>
              </li>
            ))}
            {d.failedEmails.map((e) => (
              <li key={e._id.toHexString()} className="flex items-center justify-between gap-3 py-2">
                <span>Email failed: “{e.subject}” to {e.to.join(", ")}</span>
                <Link href="/admin/emails?status=failed" className="font-medium text-brand hover:underline">Resend</Link>
              </li>
            ))}
            {d.slips.length + d.drafts.length + d.followUps.length + d.failedEmails.length === 0 && (
              <li className="py-2 text-muted">Nothing needs your attention right now.</li>
            )}
          </ul>
        </Card>

        <Card title="Recurring plans in the next 7 days" actions={<LinkButton href="/admin/plans" variant="secondary">All plans</LinkButton>}>
          {upcoming.length === 0 ? (
            <p className="text-sm text-muted">No plans will run in the next 7 days.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {upcoming.map(({ plan, next }) => (
                <li key={plan._id.toHexString()} className="flex items-center justify-between gap-3 py-2">
                  <Link href={`/admin/plans/${plan._id}`} className="font-medium hover:text-brand">{plan.name}</Link>
                  <span className="text-right text-muted">{formatDate(next.date!)} · <Money amount={planTotals(plan).total} currency={plan.currency} /> · {plan.mode === "auto" ? "sends automatically" : "draft for review"}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Recent activity" className="mt-4">
        {d.activity.length === 0 ? (
          <p className="text-sm text-muted">Activity will appear here as your team works.</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {d.activity.map((a) => (
              <li key={a._id.toHexString()} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:justify-between">
                <span><StatusBadge status="active" label={a.action.replace(/[._]/g, " ")} /> <span className="ml-2 text-muted">{a.actorEmail}</span></span>
                <span className="text-xs text-muted">{formatDateTime(a.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
