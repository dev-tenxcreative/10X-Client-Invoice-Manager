import Link from "next/link";
import { Card, Money, PageHeader, StatusBadge } from "@/components/ui";
import { globalSearch } from "@/lib/services/reports";
import { cols } from "@/lib/db";

export const metadata = { title: "Search" };

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  const r = await globalSearch(q);
  const c = await cols();
  const ms = await c.memberships.find({ userId: { $in: r.users.map((u) => u._id) } }).toArray();
  const total = r.companies.length + r.users.length + r.invoices.length + r.proposals.length;
  return (
    <>
      <PageHeader title={`Search: “${q}”`} description={q.trim().length < 2 ? "Type at least 2 characters." : `${total} result${total === 1 ? "" : "s"}`} />
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Companies">{r.companies.length ? <ul className="space-y-1 text-sm">{r.companies.map((co) => <li key={co._id.toHexString()}><Link href={`/admin/companies/${co._id}`} className="font-medium hover:text-brand">{co.name}</Link> <StatusBadge status={co.status} /></li>)}</ul> : <p className="text-sm text-muted">None</p>}</Card>
        <Card title="People">{r.users.length ? <ul className="space-y-1 text-sm">{r.users.map((u) => { const m = ms.find((x) => x.userId.equals(u._id)); return <li key={u._id.toHexString()}>{m ? <Link href={`/admin/companies/${m.companyId}?tab=contacts`} className="font-medium hover:text-brand">{u.name}</Link> : <span className="font-medium">{u.name}</span>} <span className="text-muted">{u.email}</span></li>; })}</ul> : <p className="text-sm text-muted">None</p>}</Card>
        <Card title="Invoices">{r.invoices.length ? <ul className="space-y-1 text-sm">{r.invoices.map((i) => <li key={i._id.toHexString()}><Link href={`/admin/invoices/${i._id}`} className="font-medium hover:text-brand">{i.number}</Link> · <Money amount={i.total} currency={i.currency} /></li>)}</ul> : <p className="text-sm text-muted">None</p>}</Card>
        <Card title="Proposals">{r.proposals.length ? <ul className="space-y-1 text-sm">{r.proposals.map((p) => <li key={p._id.toHexString()}><Link href={`/admin/proposals/${p._id}`} className="font-medium hover:text-brand">{p.reference}</Link> · {p.content.title}</li>)}</ul> : <p className="text-sm text-muted">None</p>}</Card>
      </div>
    </>
  );
}
