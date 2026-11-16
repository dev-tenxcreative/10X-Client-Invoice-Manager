import { Shell } from "@/components/client/shell";
import { ActionButton, ActionForm, SubmitButton } from "@/components/client/action-form";
import { getPortalContext } from "@/lib/auth/session";
import { exitViewAsAction, signOutAction, switchCompanyAction } from "@/app/actions/auth";
import { t } from "@/lib/i18n";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getPortalContext();
  const nav = [
    { href: "/portal", label: t.nav.dashboard },
    { href: "/portal/invoices", label: t.nav.invoices },
    { href: "/portal/proposals", label: t.nav.proposals },
    { href: "/portal/statement", label: t.nav.statement },
    { href: "/portal/account", label: t.nav.account },
  ];
  const switcher = ctx.companies.length > 1 ? (
    <ActionForm action={switchCompanyAction} className="flex items-center gap-2">
      <label htmlFor="company-switch" className="sr-only">Company</label>
      <select id="company-switch" name="companyId" defaultValue={ctx.company._id.toHexString()} className="max-w-[160px] rounded-md border border-line bg-white px-2 py-2 text-sm sm:max-w-xs">
        {ctx.companies.map((c) => <option key={c._id.toHexString()} value={c._id.toHexString()}>{c.name}</option>)}
      </select>
      <SubmitButton variant="secondary">Switch</SubmitButton>
    </ActionForm>
  ) : (
    <span className="hidden text-sm font-medium text-ink sm:inline">{ctx.company.name}</span>
  );
  const banner = ctx.readOnly ? (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900 sm:px-6">
      <span>{t.client.readOnlyBanner} <strong>{ctx.company.name}</strong></span>
      <ActionButton action={exitViewAsAction} variant="dark">{t.client.exitPreview}</ActionButton>
    </div>
  ) : null;
  return (
    <Shell nav={nav} user={{ name: ctx.auth.user.name, email: ctx.auth.user.email, roleLabel: ctx.readOnly ? "Admin preview" : ctx.company.name }} signOut={signOutAction} topSlot={switcher} banner={banner} accountHref="/portal/account">
      {children}
    </Shell>
  );
}
