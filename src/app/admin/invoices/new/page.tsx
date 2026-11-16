import { PageHeader } from "@/components/ui";
import { InvoiceForm } from "@/components/client/invoice-form";
import { createInvoiceAction } from "@/app/actions/admin";
import { listCompanies } from "@/lib/services/companies";
import { getSettings } from "@/lib/services/settings";
import { addDays, today } from "@/lib/dates";
import { formatRate } from "@/lib/money";

export const metadata = { title: "New invoice" };

export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<{ company?: string }> }) {
  const sp = await searchParams;
  const [companies, settings] = await Promise.all([listCompanies({ status: "active" }), getSettings()]);
  const pre = companies.find((c) => c._id.toHexString() === sp.company);
  const t = today();
  return (
    <>
      <PageHeader title="New invoice" description="The invoice number is assigned when you save. Drafts can be edited freely." back={{ href: "/admin/invoices", label: "Invoices" }} />
      <InvoiceForm
        action={createInvoiceAction}
        currencies={settings.currencies}
        companies={companies.map((c) => ({ id: c._id.toHexString(), name: c.name, currency: c.currency, terms: c.paymentTermsDays }))}
        defaults={{
          companyId: pre?._id.toHexString() ?? "",
          issueDate: t,
          dueDate: addDays(t, pre?.paymentTermsDays ?? settings.defaultPaymentTermsDays),
          currency: pre?.currency ?? settings.defaultCurrency,
          items: [],
          discount: { type: "none", value: "" },
          tax: { label: settings.tax.label, rate: formatRate(settings.tax.rateBp).replace("%", "") },
          notes: settings.invoiceNotes,
          paymentInstructions: "",
          billingPeriod: "",
          remindersEnabled: true,
        }}
      />
    </>
  );
}
