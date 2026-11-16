import { Card, DL, PageHeader } from "@/components/ui";
import { AccountForms } from "@/components/account-forms";
import { ActionForm, Field, SubmitButton } from "@/components/client/action-form";
import { updateBillingAction } from "@/app/actions/portal";
import { getPortalContext } from "@/lib/auth/session";

export const metadata = { title: "My account" };

export default async function AccountPage() {
  const ctx = await getPortalContext();
  const co = ctx.company;
  return (
    <>
      <PageHeader title="My account" />
      <AccountForms user={ctx.auth.user} readOnly={ctx.readOnly} />
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Company details">
          <DL items={[["Company", co.name], ["Registration or tax number", co.taxNumber], ["Currency", co.currency], ["Payment terms", `${co.paymentTermsDays} days`]]} />
          <p className="mt-3 text-xs text-muted">To change the company name or payment terms, please contact 10X Creative.</p>
        </Card>
        <Card title="Billing address and emails">
          <ActionForm action={updateBillingAction} className="space-y-3">
            <Field name="billingAddress" label="Billing address" defaultValue={co.billingAddress} disabled={ctx.readOnly} />
            <div className="grid grid-cols-2 gap-3">
              <Field name="city" label="City" defaultValue={co.city} disabled={ctx.readOnly} />
              <Field name="country" label="Country" defaultValue={co.country} disabled={ctx.readOnly} />
            </div>
            <Field name="billingEmails" label="Billing emails (CC on invoices)" defaultValue={co.billingEmails.join(", ")} hint="Separate with commas" disabled={ctx.readOnly} />
            {!ctx.readOnly && <SubmitButton>Save billing details</SubmitButton>}
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
