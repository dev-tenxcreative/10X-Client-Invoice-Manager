import { EmptyState, LinkButton, PageHeader, Tabs, inputClass } from "@/components/ui";
import { InvoiceTable } from "@/components/tables";
import { invoiceFilter, listInvoices, type InvoiceTab } from "@/lib/services/invoices";
import { cols } from "@/lib/db";
import { today } from "@/lib/dates";
import { t } from "@/lib/i18n";

export const metadata = { title: "Invoices" };

const TABS: InvoiceTab[] = ["all", "draft", "pending", "overdue", "paid", "void"];

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string; from?: string; to?: string }> }) {
  const sp = await searchParams;
  const tab = (TABS.includes(sp.tab as InvoiceTab) ? sp.tab : "all") as InvoiceTab;
  const invoices = await listInvoices(invoiceFilter({ tab, q: sp.q, from: sp.from, to: sp.to }));
  const c = await cols();
  const companies = await c.companies.find({ _id: { $in: [...new Set(invoices.map((i) => i.companyId.toHexString()))].map((h) => invoices.find((i) => i.companyId.toHexString() === h)!.companyId) } }, { projection: { name: 1 } }).toArray();
  const names = new Map(companies.map((co) => [co._id.toHexString(), co.name]));
  const slips = new Set((await c.paymentSubmissions.find({ status: "pending" }, { projection: { invoiceId: 1 } }).toArray()).map((s) => s.invoiceId.toHexString()));
  const qs = (k: string) => `/admin/invoices?tab=${k}${sp.q ? `&q=${encodeURIComponent(sp.q)}` : ""}`;

  return (
    <>
      <PageHeader title="Invoices" actions={<><LinkButton href="/admin/invoices/upload" variant="secondary">Upload PDF</LinkButton><LinkButton href="/admin/invoices/new">New invoice</LinkButton></>} />
      <Tabs current={tab} tabs={[
        { key: "all", label: "All", href: qs("all") },
        { key: "draft", label: "Drafts", href: qs("draft") },
        { key: "pending", label: "Pending", href: qs("pending") },
        { key: "overdue", label: "Overdue", href: qs("overdue") },
        { key: "paid", label: "Paid", href: qs("paid") },
        { key: "void", label: "Void", href: qs("void") },
      ]} />
      <form className="mb-4 grid gap-2 sm:flex sm:items-end" role="search">
        <input type="hidden" name="tab" value={tab} />
        <div><label htmlFor="q" className="text-xs text-muted">Invoice number</label><input id="q" name="q" defaultValue={sp.q} className={inputClass} placeholder="10X-INV-…" /></div>
        <div><label htmlFor="from" className="text-xs text-muted">Issued from</label><input id="from" type="date" name="from" defaultValue={sp.from} className={inputClass} /></div>
        <div><label htmlFor="to" className="text-xs text-muted">to</label><input id="to" type="date" name="to" defaultValue={sp.to} className={inputClass} /></div>
        <button className="min-h-10 rounded-md border border-line bg-white px-4 text-sm font-semibold">Filter</button>
      </form>
      {invoices.length === 0 ? (
        <EmptyState title="No invoices here" text={t.empty.invoices} action={<LinkButton href="/admin/invoices/new">New invoice</LinkButton>} />
      ) : (
        <InvoiceTable invoices={invoices} hrefBase="/admin/invoices" companyNames={names} today={today()} pendingSlips={slips} />
      )}
    </>
  );
}
