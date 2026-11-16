import { EmptyState, PageHeader, Tabs, inputClass } from "@/components/ui";
import { InvoiceTable } from "@/components/tables";
import { getPortalContext } from "@/lib/auth/session";
import { invoiceFilter, listInvoices, type InvoiceTab } from "@/lib/services/invoices";
import { cols } from "@/lib/db";
import { today } from "@/lib/dates";
import { t } from "@/lib/i18n";

export const metadata = { title: "Invoices" };

const TABS: InvoiceTab[] = ["all", "pending", "paid", "overdue"];

export default async function PortalInvoices({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string; from?: string; to?: string }> }) {
  const sp = await searchParams;
  const ctx = await getPortalContext();
  const tab = (TABS.includes(sp.tab as InvoiceTab) ? sp.tab : "all") as InvoiceTab;
  // Always scoped on the server to the active company the user belongs to.
  const invoices = await listInvoices(invoiceFilter({ companyIds: [ctx.company._id], tab, q: sp.q, from: sp.from, to: sp.to, clientView: true }));
  const c = await cols();
  const slips = new Set((await c.paymentSubmissions.find({ companyId: ctx.company._id, status: "pending" }).toArray()).map((s) => s.invoiceId.toHexString()));
  const href = (k: string) => `/portal/invoices?tab=${k}`;
  return (
    <>
      <PageHeader title="Invoices" description={ctx.company.name} />
      <Tabs current={tab} tabs={[{ key: "all", label: "All", href: href("all") }, { key: "pending", label: "Pending", href: href("pending") }, { key: "paid", label: "Paid", href: href("paid") }, { key: "overdue", label: "Overdue", href: href("overdue") }]} />
      <form className="mb-4 grid gap-2 sm:flex sm:items-end" role="search">
        <input type="hidden" name="tab" value={tab} />
        <div><label htmlFor="q" className="text-xs text-muted">Invoice number</label><input id="q" name="q" defaultValue={sp.q} className={inputClass} /></div>
        <div><label htmlFor="from" className="text-xs text-muted">From</label><input id="from" type="date" name="from" defaultValue={sp.from} className={inputClass} /></div>
        <div><label htmlFor="to" className="text-xs text-muted">To</label><input id="to" type="date" name="to" defaultValue={sp.to} className={inputClass} /></div>
        <button className="min-h-10 rounded-md border border-line bg-white px-4 text-sm font-semibold">Search</button>
      </form>
      {invoices.length === 0 ? <EmptyState title="No invoices here" text={t.client.noInvoices} /> : <InvoiceTable invoices={invoices} hrefBase="/portal/invoices" today={today()} pendingSlips={slips} />}
    </>
  );
}
