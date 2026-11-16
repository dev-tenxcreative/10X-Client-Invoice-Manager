import Link from "next/link";
import { Card, PageHeader, Table, Td, Th, buttonClass } from "@/components/ui";
import { AGING_BUCKETS, agingReport, revenueByMonth, totalsByCompany } from "@/lib/services/reports";
import { formatMoney } from "@/lib/money";
import { periodLabel } from "@/lib/dates";

export const metadata = { title: "Reports" };

export default async function ReportsPage() {
  const [revenue, aging, byCompany] = await Promise.all([revenueByMonth(12), agingReport(), totalsByCompany()]);
  return (
    <>
      <PageHeader title="Reports" description="Amounts are shown per currency and never mixed." />
      <div className="space-y-6">
        <Card title="Revenue by month (last 12 months)" actions={<a href="/api/reports/revenue.csv" className={buttonClass("secondary")}>Export CSV</a>}>
          {revenue.length === 0 ? <p className="text-sm text-muted">No invoices or payments yet.</p> : (
            <Table>
              <thead><tr><Th>Month</Th><Th>Currency</Th><Th right>Billed</Th><Th right>Collected</Th></tr></thead>
              <tbody>{revenue.map((r) => (
                <tr key={`${r.period}${r.currency}`}><Td>{periodLabel(r.period)}</Td><Td>{r.currency}</Td><Td right>{formatMoney(r.billed, r.currency)}</Td><Td right>{formatMoney(r.collected, r.currency)}</Td></tr>
              ))}</tbody>
            </Table>
          )}
        </Card>
        <Card title="Aging of unpaid invoices" actions={<a href="/api/reports/aging.csv" className={buttonClass("secondary")}>Export CSV</a>}>
          {Object.keys(aging).length === 0 ? <p className="text-sm text-muted">Nothing is outstanding.</p> : (
            <Table>
              <thead><tr><Th>Currency</Th>{AGING_BUCKETS.map((b) => <Th key={b} right>{b}</Th>)}</tr></thead>
              <tbody>{Object.entries(aging).map(([cur, v]) => (
                <tr key={cur}><Td className="font-semibold">{cur}</Td>{v.map((n, i) => <Td key={i} right className={i >= 3 && n > 0 ? "text-brand font-semibold" : ""}>{formatMoney(n, cur)}</Td>)}</tr>
              ))}</tbody>
            </Table>
          )}
        </Card>
        <Card title="Totals by company" actions={<a href="/api/reports/companies.csv" className={buttonClass("secondary")}>Export CSV</a>}>
          {byCompany.length === 0 ? <p className="text-sm text-muted">No invoices yet.</p> : (
            <Table>
              <thead><tr><Th>Company</Th><Th>Currency</Th><Th right>Billed</Th><Th right>Paid</Th><Th right>Outstanding</Th><Th right>Overdue</Th></tr></thead>
              <tbody>{byCompany.map((r) => (
                <tr key={`${r.companyId}${r.currency}`}><Td><Link href={`/admin/companies/${r.companyId}`} className="font-medium hover:text-brand">{r.name}</Link></Td><Td>{r.currency}</Td><Td right>{formatMoney(r.billed, r.currency)}</Td><Td right>{formatMoney(r.paid, r.currency)}</Td><Td right>{formatMoney(r.outstanding, r.currency)}</Td><Td right className={r.overdue > 0 ? "text-brand font-semibold" : ""}>{formatMoney(r.overdue, r.currency)}</Td></tr>
              ))}</tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
