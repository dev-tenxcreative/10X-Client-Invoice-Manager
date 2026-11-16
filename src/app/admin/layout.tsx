import { Shell } from "@/components/client/shell";
import { requireAdmin } from "@/lib/auth/session";
import { signOutAction } from "@/app/actions/auth";
import { cols } from "@/lib/db";
import { t } from "@/lib/i18n";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireAdmin();
  const c = await cols();
  const [slips, drafts, failed] = await Promise.all([
    c.paymentSubmissions.countDocuments({ status: "pending" }),
    c.invoices.countDocuments({ status: "draft" }),
    c.emailLogs.countDocuments({ status: "failed" }),
  ]);
  const nav = [
    { href: "/admin", label: t.nav.dashboard },
    { href: "/admin/companies", label: t.nav.clients },
    { href: "/admin/proposals", label: t.nav.proposals },
    { href: "/admin/invoices", label: t.nav.invoices, badge: drafts },
    { href: "/admin/plans", label: t.nav.plans },
    { href: "/admin/payments", label: t.nav.payments, badge: slips },
    { href: "/admin/reports", label: t.nav.reports },
    { href: "/admin/emails", label: t.nav.emails, badge: failed },
    { href: "/admin/audit", label: t.nav.audit },
    { href: "/admin/settings", label: t.nav.settings },
    ...(user.role === "super_admin" ? [{ href: "/admin/admins", label: t.nav.admins }] : []),
  ];
  return (
    <Shell
      nav={nav}
      user={{ name: user.name, email: user.email, roleLabel: user.role === "super_admin" ? "Super admin" : "Admin" }}
      signOut={signOutAction}
      search
      accountHref="/admin/profile"
      newMenu={[
        { href: "/admin/companies/new", label: "Client" },
        { href: "/admin/proposals/new", label: "Proposal" },
        { href: "/admin/invoices/new", label: "Invoice" },
      ]}
    >
      {children}
    </Shell>
  );
}
