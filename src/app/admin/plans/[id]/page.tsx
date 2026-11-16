import Link from "next/link";
import { notFound } from "next/navigation";
import { ObjectId } from "mongodb";
import { Card, DL, Money, PageHeader, StatusBadge } from "@/components/ui";
import { InvoiceTable } from "@/components/tables";
import { ActionButton } from "@/components/client/action-form";
import { PlanForm } from "@/components/client/plan-form";
import { planOpAction, updatePlanAction } from "@/app/actions/admin";
import { cols } from "@/lib/db";
import { listCompanies } from "@/lib/services/companies";
import { getSettings } from "@/lib/services/settings";
import { planNext, planTotals } from "@/lib/services/plans";
import { formatDate, nextPeriod, periodLabel, periodOf, today } from "@/lib/dates";
import { formatMoney, formatQty, formatRate, minorToInput } from "@/lib/money";

export const metadata = { title: "Recurring plan" };

export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!ObjectId.isValid(id)) notFound();
  const c = await cols();
  const plan = await c.recurringPlans.findOne({ _id: new ObjectId(id) });
  if (!plan) notFound();
  const [company, invoices, companies, settings, next] = await Promise.all([
    c.companies.findOne({ _id: plan.companyId }),
    c.invoices.find({ planId: plan._id }).sort({ period: -1 }).toArray(),
    listCompanies({ status: "all" }),
    getSettings(),
    planNext(plan),
  ]);
  const t = today();
  const invoiced = new Set(invoices.map((i) => i.period));
  // Upcoming months that can be skipped (next 6).
  const upcoming: string[] = [];
  for (let p = periodOf(t > plan.startDate ? t : plan.startDate), i = 0; i < 6; p = nextPeriod(p), i++) if (!invoiced.has(p)) upcoming.push(p);
  const totals = planTotals(plan);

  return (
    <>
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-3">{plan.name} <StatusBadge status={plan.status} /></span>}
        description={<>For <Link href={`/admin/companies/${plan.companyId}`} className="font-medium text-ink hover:text-brand">{company?.name}</Link></>}
        back={{ href: "/admin/plans", label: "Recurring plans" }}
        actions={
          <>
            {plan.status === "active" && <ActionButton action={planOpAction} fields={{ id, op: "run" }} variant="primary"
              confirm={{ title: "Run this plan now?", summary: `Creates the next month's invoice for ${formatMoney(totals.total, plan.currency)} now. ${plan.mode === "auto" ? "It will be emailed to the client." : "It will be saved as a draft for review."}` }}>Run now</ActionButton>}
            {plan.status === "active" && <ActionButton action={planOpAction} fields={{ id, op: "paused" }}>Pause</ActionButton>}
            {plan.status === "paused" && <ActionButton action={planOpAction} fields={{ id, op: "active" }} variant="primary">Resume</ActionButton>}
            {plan.status !== "ended" && <ActionButton action={planOpAction} fields={{ id, op: "ended" }} variant="danger" confirm={{ title: "End this plan?", summary: "No more invoices will be created. Existing invoices are not affected.", danger: true }}>End plan</ActionButton>}
          </>
        }
      />
      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <Card title="Next invoice" className="lg:col-span-1">
          {plan.status === "active" && next.date ? (
            <DL items={[["Date", next.date === t ? `${formatDate(next.date)} (next job run)` : formatDate(next.date)], ["Amount", <Money key="a" amount={next.amount} currency={plan.currency} />], ["Mode", plan.mode === "auto" ? "Send automatically" : "Draft for review"]]} />
          ) : <p className="text-sm text-muted">{plan.status === "active" ? "No further invoices (end date reached)." : `This plan is ${plan.status}.`}</p>}
        </Card>
        <Card title="Skip a month" className="lg:col-span-2">
          <p className="mb-3 text-sm text-muted">Skipped months get no invoice.</p>
          <div className="flex flex-wrap gap-2">
            {upcoming.map((p) => {
              const skipped = plan.skippedPeriods.includes(p);
              return (
                <ActionButton key={p} action={planOpAction} fields={{ id, op: skipped ? "unskip" : "skip", period: p }} variant={skipped ? "dark" : "secondary"}>
                  {skipped ? `Skipped: ${periodLabel(p)} (undo)` : `Skip ${periodLabel(p)}`}
                </ActionButton>
              );
            })}
          </div>
        </Card>
      </div>

      <h2 className="mb-3 text-lg font-semibold">Invoices from this plan</h2>
      {invoices.length === 0 ? <p className="mb-6 text-sm text-muted">No invoices yet.</p> : <div className="mb-8"><InvoiceTable invoices={invoices} hrefBase="/admin/invoices" today={t} /></div>}

      <h2 className="mb-3 text-lg font-semibold">Edit plan</h2>
      <PlanForm
        action={updatePlanAction}
        currencies={settings.currencies}
        companies={companies.map((co) => ({ id: co._id.toHexString(), name: co.name, currency: co.currency, terms: co.paymentTermsDays }))}
        defaults={{
          id,
          companyId: plan.companyId.toHexString(),
          name: plan.name,
          currency: plan.currency,
          items: plan.items.map((i) => ({ title: i.title, detail: i.detail ?? "", qty: formatQty(i.qty100), unitPrice: minorToInput(i.unitPrice, plan.currency), period: i.period ?? "" })),
          discount: { type: plan.discount.type, value: plan.discount.type === "percent" ? formatRate(plan.discount.value).replace("%", "") : plan.discount.type === "amount" ? minorToInput(plan.discount.value, plan.currency) : "" },
          tax: { label: plan.tax.label, rate: formatRate(plan.tax.rateBp).replace("%", "") },
          startDate: plan.startDate,
          endDate: plan.endDate ?? "",
          billingDay: plan.billingDay,
          dueAfterDays: plan.dueAfterDays,
          mode: plan.mode,
          notes: plan.notes ?? "",
        }}
      />
    </>
  );
}
