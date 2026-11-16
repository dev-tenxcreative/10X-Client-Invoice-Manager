import { withRequestDb } from "@/lib/db";
import { apiScope, notFoundResponse, unauthorized } from "@/lib/auth/api";
import { AGING_BUCKETS, agingReport, revenueByMonth, totalsByCompany } from "@/lib/services/reports";
import { csvResponse, toCsv } from "@/lib/csv";
import { formatDecimal } from "@/lib/money";
import { today } from "@/lib/dates";

const m = (n: number) => formatDecimal(n, 2).replace(/,/g, "");

export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  return withRequestDb(async () => {
    const scope = await apiScope();
    if (!scope) return unauthorized();
    if (!scope.isAdmin) return notFoundResponse();
    const { name } = await params;
    const stamp = today();
    if (name === "revenue.csv") {
      const rows = await revenueByMonth(24);
      return csvResponse(toCsv([["Month", "Currency", "Billed", "Collected"], ...rows.map((r) => [r.period, r.currency, m(r.billed), m(r.collected)])]), `revenue-${stamp}.csv`);
    }
    if (name === "aging.csv") {
      const a = await agingReport();
      return csvResponse(toCsv([["Currency", ...AGING_BUCKETS], ...Object.entries(a).map(([cur, v]) => [cur, ...v.map(m)])]), `aging-${stamp}.csv`);
    }
    if (name === "companies.csv") {
      const rows = await totalsByCompany();
      return csvResponse(toCsv([["Company", "Currency", "Billed", "Paid", "Outstanding", "Overdue"], ...rows.map((r) => [r.name, r.currency, m(r.billed), m(r.paid), m(r.outstanding), m(r.overdue)])]), `companies-${stamp}.csv`);
    }
    return notFoundResponse();
  });
}
