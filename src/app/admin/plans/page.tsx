import Link from "next/link";
import { EmptyState, LinkButton, Money, PageHeader, StatusBadge, Table, Td, Th } from "@/components/ui";
import { cols } from "@/lib/db";
import { planNext, planTotals } from "@/lib/services/plans";
import { formatDate } from "@/lib/dates";
import { t } from "@/lib/i18n";

export const metadata = { title: "Recurring plans" };

export default async function PlansPage() {
  const c = await cols();
  const plans = await c.recurringPlans.find().sort({ status: 1, name: 1 }).toArray();
  const companies = await c.companies.find({ _id: { $in: plans.map((p) => p.companyId) } }, { projection: { name: 1 } }).toArray();
  const names = new Map(companies.map((co) => [co._id.toHexString(), co.name]));
  const rows = await Promise.all(plans.map(async (p) => ({ p, next: await planNext(p) })));
  return (
    <>
      <PageHeader title="Recurring plans" description="Each active plan creates one invoice per month on its billing day (08:00 Colombo time)." actions={<LinkButton href="/admin/plans/new">New plan</LinkButton>} />
      {plans.length === 0 ? <EmptyState title="No recurring plans" text={t.empty.plans} action={<LinkButton href="/admin/plans/new">New plan</LinkButton>} /> : (
        <Table>
          <thead><tr><Th>Plan</Th><Th>Company</Th><Th>Billing day</Th><Th>Mode</Th><Th right>Monthly amount</Th><Th>Next invoice</Th><Th>Status</Th></tr></thead>
          <tbody>
            {rows.map(({ p, next }) => (
              <tr key={p._id.toHexString()} className="hover:bg-zinc-50">
                <Td><Link href={`/admin/plans/${p._id}`} className="font-semibold hover:text-brand">{p.name}</Link></Td>
                <Td>{names.get(p.companyId.toHexString())}</Td>
                <Td>{p.billingDay}</Td>
                <Td>{p.mode === "auto" ? "Send automatically" : "Draft for review"}</Td>
                <Td right><Money amount={planTotals(p).total} currency={p.currency} /></Td>
                <Td>{p.status === "active" && next.date ? formatDate(next.date) : "—"}</Td>
                <Td><StatusBadge status={p.status} /></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
