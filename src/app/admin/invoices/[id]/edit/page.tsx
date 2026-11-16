import { notFound, redirect } from "next/navigation";
import { ObjectId } from "mongodb";
import { PageHeader } from "@/components/ui";
import { InvoiceForm } from "@/components/client/invoice-form";
import { updateInvoiceAction } from "@/app/actions/admin";
import { cols } from "@/lib/db";
import { listCompanies } from "@/lib/services/companies";
import { getSettings } from "@/lib/services/settings";
import { formatQty, formatRate, minorToInput } from "@/lib/money";

export const metadata = { title: "Edit invoice" };

export default async function EditInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!ObjectId.isValid(id)) notFound();
  const c = await cols();
  const inv = await c.invoices.findOne({ _id: new ObjectId(id) });
  if (!inv) notFound();
  if (inv.status !== "draft" || inv.source !== "generated") redirect(`/admin/invoices/${id}`);
  const [companies, settings] = await Promise.all([listCompanies({ status: "all" }), getSettings()]);
  return (
    <>
      <PageHeader title={`Edit ${inv.number}`} description="Drafts can be changed freely until they are sent." back={{ href: `/admin/invoices/${id}`, label: inv.number }} />
      <InvoiceForm
        action={updateInvoiceAction}
        currencies={settings.currencies}
        companies={companies.map((co) => ({ id: co._id.toHexString(), name: co.name, currency: co.currency, terms: co.paymentTermsDays }))}
        defaults={{
          id,
          companyId: inv.companyId.toHexString(),
          issueDate: inv.issueDate,
          dueDate: inv.dueDate,
          currency: inv.currency,
          items: inv.items.map((i) => ({ title: i.title, detail: i.detail ?? "", qty: formatQty(i.qty100), unitPrice: minorToInput(i.unitPrice, inv.currency), period: i.period ?? "" })),
          discount: { type: inv.discount.type, value: inv.discount.type === "percent" ? formatRate(inv.discount.value).replace("%", "") : inv.discount.type === "amount" ? minorToInput(inv.discount.value, inv.currency) : "" },
          tax: { label: inv.tax.label, rate: formatRate(inv.tax.rateBp).replace("%", "") },
          notes: inv.notes ?? "",
          paymentInstructions: inv.paymentInstructions ?? "",
          billingPeriod: inv.billingPeriod ?? "",
          remindersEnabled: inv.remindersEnabled,
        }}
      />
    </>
  );
}
