import { PageHeader } from "@/components/ui";
import { AccountForms } from "@/components/account-forms";
import { requireAdmin } from "@/lib/auth/session";

export const metadata = { title: "My account" };

export default async function ProfilePage() {
  const { user } = await requireAdmin();
  return (
    <>
      <PageHeader title="My account" description={user.role === "super_admin" ? "Super admin. This account cannot be deleted, deactivated or demoted." : "Admin"} />
      <AccountForms user={user} />
    </>
  );
}
