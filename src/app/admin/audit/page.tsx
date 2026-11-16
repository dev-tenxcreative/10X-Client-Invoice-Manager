import { EmptyState, PageHeader, Table, Td, Th, inputClass } from "@/components/ui";
import { cols } from "@/lib/db";
import { formatDateTime } from "@/lib/dates";
import { escapeRegex } from "@/lib/services/companies";

export const metadata = { title: "Audit log" };

function short(v: unknown): string {
  if (v === undefined || v === null) return "";
  const s = JSON.stringify(v);
  return s.length > 300 ? s.slice(0, 300) + "…" : s;
}

/** Read-only. There is no code path that edits or deletes audit entries. */
export default async function AuditPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const sp = await searchParams;
  const c = await cols();
  const filter = sp.q ? { $or: [{ action: { $regex: escapeRegex(sp.q), $options: "i" } }, { actorEmail: { $regex: escapeRegex(sp.q), $options: "i" } }] } : {};
  const logs = await c.auditLogs.find(filter).sort({ at: -1 }).limit(300).toArray();
  return (
    <>
      <PageHeader title="Audit log" description="Who did what and when. Entries cannot be edited or deleted." />
      <form className="mb-4 flex gap-2" role="search">
        <label htmlFor="q" className="sr-only">Filter</label>
        <input id="q" name="q" defaultValue={sp.q} placeholder="Filter by action or email, e.g. invoice.void" className={`${inputClass} max-w-sm`} />
        <button className="rounded-md border border-line bg-white px-4 text-sm font-semibold">Filter</button>
      </form>
      {logs.length === 0 ? <EmptyState title="No entries" text="Actions such as sign-ins, invoice changes and payments are recorded here." /> : (
        <Table>
          <thead><tr><Th>When</Th><Th>Who</Th><Th>Action</Th><Th>Record</Th><Th>Before</Th><Th>After</Th></tr></thead>
          <tbody>{logs.map((l) => (
            <tr key={l._id.toHexString()}>
              <Td className="whitespace-nowrap text-xs">{formatDateTime(l.at)}</Td>
              <Td className="text-xs">{l.actorEmail}{l.ip && <div className="text-muted">{l.ip}</div>}</Td>
              <Td className="text-xs font-medium">{l.action}</Td>
              <Td className="text-xs">{l.entityType} {l.entityId ? String(l.entityId).slice(-8) : ""}</Td>
              <Td className="max-w-xs break-all font-mono text-[11px] text-muted">{short(l.before)}</Td>
              <Td className="max-w-xs break-all font-mono text-[11px] text-muted">{short(l.after)}</Td>
            </tr>
          ))}</tbody>
        </Table>
      )}
    </>
  );
}
