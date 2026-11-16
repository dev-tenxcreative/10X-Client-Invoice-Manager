import Link from "next/link";
import { Card, EmptyState, PageHeader, Table, Td, Th, buttonClass, inputClass } from "@/components/ui";
import { getPortalContext } from "@/lib/auth/session";
import { statement } from "@/lib/services/reports";
import { formatDate, isDateString } from "@/lib/dates";
import { formatMoney } from "@/lib/money";

export const metadata = { title: "Statement" };

export default async function StatementPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const sp = await searchParams;
  const ctx = await getPortalContext();
  const from = sp.from && isDateString(sp.from) ? sp.from : undefined;
  const to = sp.to && isDateString(sp.to) ? sp.to : undefined;
  const data = await statement([ctx.company._id], from, to);
  const qs = new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) }).toString();
  return (
    <>
      <PageHeader title="Statement" description={`Full history of invoices and payments for ${ctx.company.name}.`}
        actions={<><a href={`/api/statement/csv?${qs}`} className={buttonClass("secondary")}>Export CSV</a><a href={`/api/statement/pdf?${qs}`} className={buttonClass("secondary")}>Export PDF</a></>} />
      <form className="mb-4 grid gap-2 sm:flex sm:items-end">
        <div><label htmlFor="from" className="text-xs text-muted">From</label><input id="from" name="from" type="date" defaultValue={from} className={inputClass} /></div>
        <div><label htmlFor="to" className="text-xs text-muted">To</label><input id="to" name="to" type="date" defaultValue={to} className={inputClass} /></div>
        <button className="min-h-10 rounded-md border border-line bg-white px-4 text-sm font-semibold">Show</button>
      </form>
      {Object.keys(data).length === 0 ? <EmptyState title="No history yet" text="Invoices and payments will be listed here with a running balance." /> : (
        <div className="space-y-6">
          {Object.entries(data).map(([cur, s]) => (
            <Card key={cur} title={`${cur} account`}>
              <Table>
                <thead><tr><Th>Date</Th><Th>Reference</Th><Th>Description</Th><Th right>Charges</Th><Th right>Payments</Th><Th right>Balance</Th></tr></thead>
                <tbody>
                  {from && <tr className="bg-zinc-50"><Td colSpan={5}>Opening balance on {formatDate(from)}</Td><Td right className="font-semibold">{formatMoney(s.opening, cur)}</Td></tr>}
                  {s.lines.map((l, i) => (
                    <tr key={i}>
                      <Td className="num">{formatDate(l.date)}</Td>
                      <Td><Link href={`/portal/invoices/${l.id}`} className="hover:text-brand">{l.ref}</Link></Td>
                      <Td>{l.description}</Td>
                      <Td right>{l.debit ? formatMoney(l.debit, cur) : ""}</Td>
                      <Td right>{l.credit ? formatMoney(l.credit, cur) : ""}</Td>
                      <Td right className="font-semibold">{formatMoney(l.balance, cur)}</Td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr className="bg-zinc-50 font-bold"><Td colSpan={5}>Closing balance</Td><Td right>{formatMoney(s.closing, cur)}</Td></tr></tfoot>
              </Table>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
