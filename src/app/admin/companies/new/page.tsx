import { PageHeader } from "@/components/ui";
import { NewClientForm } from "@/components/client/new-client-form";
import { checkDuplicatesAction, createClientAction } from "@/app/actions/admin";
import { listCompanies } from "@/lib/services/companies";
import { getSettings } from "@/lib/services/settings";

export const metadata = { title: "New client" };

export default async function NewClientPage() {
  const [companies, settings] = await Promise.all([listCompanies({ status: "active" }), getSettings()]);
  return (
    <>
      <PageHeader title="New client" description="Add the contact person and their company in one step. Nothing is saved unless everything is valid." back={{ href: "/admin/companies", label: "Clients" }} />
      <NewClientForm
        action={createClientAction}
        checkDuplicates={checkDuplicatesAction}
        companies={companies.map((c) => ({ id: c._id.toHexString(), name: c.name }))}
        defaults={{ currency: settings.defaultCurrency, paymentTermsDays: settings.defaultPaymentTermsDays }}
      />
    </>
  );
}
