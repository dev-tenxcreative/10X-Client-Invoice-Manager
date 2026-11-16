import Link from "next/link";
import { EmptyState, LinkButton, MoneyList, PageHeader, StatusBadge, Table, Tabs, Td, Th, inputClass } from "@/components/ui";
import { listCompanies } from "@/lib/services/companies";
import { cols } from "@/lib/db";
import { companyInvoiceStats } from "@/lib/services/invoices";
import { t } from "@/lib/i18n";

export const metadata = { title: "Clients" };

export default async function CompaniesPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const sp = await searchParams;
  const status = sp.status === "archived" ? "archived" : sp.status === "all" ? "all" : "active";
  const companies = await listCompanies({ q: sp.q, status });
  const c = await cols();
  const ids = companies.map((x) => x._id);
  const [invoices, memberships] = await Promise.all([
    c.invoices.find({ companyId: { $in: ids } }).toArray(),
    c.memberships.find({ companyId: { $in: ids } }).toArray(),
  ]);

  return (
    <>
      <PageHeader title="Clients" description="Companies you bill and their contacts." actions={<LinkButton href="/admin/companies/new">New client</LinkButton>} />
      <Tabs current={status} tabs={[
        { key: "active", label: "Active", href: "/admin/companies" },
        { key: "archived", label: "Archived", href: "/admin/companies?status=archived" },
        { key: "all", label: "All", href: "/admin/companies?status=all" },
      ]} />
      <form className="mb-4 flex gap-2" role="search">
        <input type="hidden" name="status" value={status} />
        <label htmlFor="q" className="sr-only">Search companies</label>
        <input id="q" name="q" defaultValue={sp.q} placeholder="Search by company name" className={`${inputClass} max-w-sm`} />
        <button className="rounded-md border border-line bg-white px-4 text-sm font-semibold">Search</button>
      </form>
      {companies.length === 0 ? (
        <EmptyState title={sp.q ? "No matching companies" : "No clients yet"} text={t.empty.companies} action={<LinkButton href="/admin/companies/new">Add a client</LinkButton>} />
      ) : (
        <Table>
          <thead><tr><Th>Company</Th><Th>Contacts</Th><Th>Currency</Th><Th right>Outstanding</Th><Th right>Overdue</Th><Th>Status</Th></tr></thead>
          <tbody>
            {companies.map((co) => {
              const stats = companyInvoiceStats(invoices.filter((i) => i.companyId.equals(co._id)));
              return (
                <tr key={co._id.toHexString()} className="hover:bg-zinc-50">
                  <Td><Link href={`/admin/companies/${co._id}`} className="font-semibold text-ink hover:text-brand">{co.name}</Link><div className="text-xs text-muted">{co.city}, {co.country}</div></Td>
                  <Td>{memberships.filter((m) => m.companyId.equals(co._id)).length}</Td>
                  <Td>{co.currency}</Td>
                  <Td right><MoneyList values={stats.outstanding} /></Td>
                  <Td right className="text-brand"><MoneyList values={stats.overdue} /></Td>
                  <Td><StatusBadge status={co.status} /></Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </>
  );
}
