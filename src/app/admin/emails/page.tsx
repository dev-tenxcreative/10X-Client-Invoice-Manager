import { EmptyState, PageHeader, StatusBadge, Table, Tabs, Td, Th } from "@/components/ui";
import { ActionButton } from "@/components/client/action-form";
import { resendEmailAction } from "@/app/actions/admin";
import { cols } from "@/lib/db";
import { formatDateTime } from "@/lib/dates";
import { EMAIL_TEMPLATE_LABELS } from "@/lib/settings-defaults";
import { t } from "@/lib/i18n";

export const metadata = { title: "Email log" };

export default async function EmailsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const sp = await searchParams;
  const status = ["sent", "failed", "queued"].includes(sp.status ?? "") ? sp.status! : "all";
  const c = await cols();
  const logs = await c.emailLogs.find(status === "all" ? {} : { status: status as "sent" }, { projection: { html: 0 } }).sort({ createdAt: -1 }).limit(300).toArray();
  return (
    <>
      <PageHeader title="Email log" description="Every email the portal sends. Failed emails are retried by the daily job up to 3 times." />
      <Tabs current={status} tabs={[
        { key: "all", label: "All", href: "/admin/emails" },
        { key: "sent", label: "Sent", href: "/admin/emails?status=sent" },
        { key: "failed", label: "Failed", href: "/admin/emails?status=failed" },
        { key: "queued", label: "Queued", href: "/admin/emails?status=queued" },
      ]} />
      {logs.length === 0 ? <EmptyState title="No emails" text={t.empty.emails} /> : (
        <Table>
          <thead><tr><Th>When</Th><Th>To</Th><Th>Subject</Th><Th>Type</Th><Th>Status</Th><Th /></tr></thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l._id.toHexString()}>
                <Td className="whitespace-nowrap text-xs">{formatDateTime(l.createdAt)}</Td>
                <Td className="text-xs">{l.to.join(", ")}{l.cc.length > 0 && <div className="text-muted">cc {l.cc.join(", ")}</div>}</Td>
                <Td>{l.subject}{l.attachments.length > 0 && <div className="text-xs text-muted">📎 {l.attachments.map((a) => a.filename).join(", ")}</div>}</Td>
                <Td className="text-xs">{EMAIL_TEMPLATE_LABELS[l.template] ?? l.template}</Td>
                <Td><StatusBadge status={l.status} />{l.error && <div className="mt-1 max-w-xs text-xs text-red-700">{l.error}</div>}<div className="text-xs text-muted">{l.attempts} attempt{l.attempts === 1 ? "" : "s"}{l.provider ? ` · ${l.provider}` : ""}</div></Td>
                <Td><ActionButton action={resendEmailAction} fields={{ id: l._id.toHexString() }} confirm={{ title: "Resend this email?", summary: `“${l.subject}” will be sent again to ${l.to.join(", ")}.` }}>Resend</ActionButton></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
