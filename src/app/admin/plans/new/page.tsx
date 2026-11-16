import { PageHeader } from "@/components/ui";
import { PlanForm } from "@/components/client/plan-form";
import { createPlanAction } from "@/app/actions/admin";
import { listCompanies } from "@/lib/services/companies";
import { getSettings } from "@/lib/services/settings";
import { today } from "@/lib/dates";
import { formatRate } from "@/lib/money";

export const metadata = { title: "New recurring plan" };

export default async function NewPlanPage({ searchParams }: { searchParams: Promise<{ company?: string }> }) {
  const sp = await searchParams;
  const [companies, settings] = await Promise.all([listCompanies({ status: "active" }), getSettings()]);
  const pre = companies.find((c) => c._id.toHexString() === sp.company);
  return (
    <>
      <PageHeader title="New recurring plan" description="For monthly retainers. The daily job creates exactly one invoice per month." back={{ href: "/admin/plans", label: "Recurring plans" }} />
      <PlanForm
        action={createPlanAction}
        currencies={settings.currencies}
        companies={companies.map((c) => ({ id: c._id.toHexString(), name: c.name, currency: c.currency, terms: c.paymentTermsDays }))}
        defaults={{
          companyId: pre?._id.toHexString() ?? "",
          name: "",
          currency: pre?.currency ?? settings.defaultCurrency,
          items: [],
          discount: { type: "none", value: "" },
          tax: { label: settings.tax.label, rate: formatRate(settings.tax.rateBp).replace("%", "") },
          startDate: today(),
          endDate: "",
          billingDay: 1,
          dueAfterDays: pre?.paymentTermsDays ?? settings.defaultPaymentTermsDays,
          mode: "review",
          notes: "",
        }}
      />
    </>
  );
}
