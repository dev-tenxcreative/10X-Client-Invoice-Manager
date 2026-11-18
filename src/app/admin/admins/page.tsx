import { Card, PageHeader, StatusBadge, Table, Td, Th } from "@/components/ui";
import { ActionButton, ActionForm, Field, SubmitButton } from "@/components/client/action-form";
import { adminUserAction, inviteAdminAction } from "@/app/actions/admin";
import { requireSuperAdmin } from "@/lib/auth/session";
import { cols } from "@/lib/db";
import { formatDateTime } from "@/lib/dates";
import { listRemovedAdmins } from "@/lib/services/users";

export const metadata = { title: "Admins" };

/** Visible to the super admin only (also enforced in every admin-management action). */
export default async function AdminsPage() {
  await requireSuperAdmin();
  const c = await cols();
  const [admins, removed] = await Promise.all([
    c.users.find({ role: { $in: ["admin", "super_admin"] } }).sort({ role: -1, name: 1 }).toArray(),
    listRemovedAdmins(),
  ]);
  return (
    <>
      <PageHeader title="Admins" description="Only the super admin can invite, deactivate or remove admins." />
      <Table className="mb-6">
        <thead><tr><Th>Name</Th><Th>Email</Th><Th>Role</Th><Th>Status</Th><Th>Last sign-in</Th><Th>Actions</Th></tr></thead>
        <tbody>
          {admins.map((u) => {
            const isSuper = u.role === "super_admin";
            const fid = u._id.toHexString();
            return (
              <tr key={fid}>
                <Td className="font-semibold">{u.name}</Td>
                <Td>{u.email}</Td>
                <Td>{isSuper ? "Super admin" : "Admin"}</Td>
                <Td><StatusBadge status={u.status} /></Td>
                <Td className="text-xs text-muted">{u.lastSignInAt ? formatDateTime(u.lastSignInAt) : "Never"}</Td>
                <Td>
                  {isSuper ? <span className="text-xs text-muted">Protected account</span> : (
                    <div className="flex flex-wrap gap-2">
                      {u.status === "invited" && <ActionButton action={adminUserAction} fields={{ userId: fid, op: "resend" }}>Resend invite</ActionButton>}
                      {u.status === "invited" && <ActionButton action={adminUserAction} fields={{ userId: fid, op: "cancel" }} variant="ghost">Cancel invite</ActionButton>}
                      {u.status === "active" && <ActionButton action={adminUserAction} fields={{ userId: fid, op: "deactivate" }} variant="danger" confirm={{ title: "Deactivate this admin?", summary: `${u.name} will be signed out and cannot sign in.`, danger: true }}>Deactivate</ActionButton>}
                      {u.status === "deactivated" && u.passwordHash && <ActionButton action={adminUserAction} fields={{ userId: fid, op: "reactivate" }}>Reactivate</ActionButton>}
                      {u.status === "deactivated" && !u.passwordHash && <ActionButton action={adminUserAction} fields={{ userId: fid, op: "resend" }}>Resend invite</ActionButton>}
                      <ActionButton action={adminUserAction} fields={{ userId: fid, op: "remove" }} variant="danger" confirm={{ title: "Remove admin access?", summary: `${u.name} will lose admin access and be signed out. Their past actions stay in the audit log.`, danger: true, confirmLabel: "Remove" }}>Remove</ActionButton>
                    </div>
                  )}
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      {removed.length > 0 && (
        <Card title="Removed admins" className="mb-6">
          <p className="mb-3 text-sm text-muted">These people had admin access before. Restoring sends them a new activation link to set a new password.</p>
          <Table>
            <thead><tr><Th>Name</Th><Th>Email</Th><Th>Removed</Th><Th>Actions</Th></tr></thead>
            <tbody>
              {removed.map((u) => (
                <tr key={u._id.toHexString()}>
                  <Td className="font-semibold">{u.name}</Td>
                  <Td>{u.email}</Td>
                  <Td className="text-xs text-muted">{u.removedAdminAt ? formatDateTime(u.removedAdminAt) : "Earlier"}</Td>
                  <Td>
                    <ActionButton action={adminUserAction} fields={{ userId: u._id.toHexString(), op: "restore" }}
                      confirm={{ title: "Restore admin access?", summary: `${u.name} will get an email with a new activation link. Their old password will not work.`, confirmLabel: "Restore access" }}>
                      Restore access
                    </ActionButton>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
      <Card title="Invite an admin">
        <ActionForm action={inviteAdminAction} resetOnSuccess className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Field name="name" label="Full name" required />
          <Field name="email" label="Email" type="email" required />
          <SubmitButton>Send invitation</SubmitButton>
        </ActionForm>
        <p className="mt-3 text-xs text-muted">They get an activation link (valid 72 hours) to set their own password. Admins have full access to clients and billing but cannot manage admins.</p>
      </Card>
    </>
  );
}
