import { cookies } from "next/headers";
import { ObjectId } from "mongodb";
import { cols, withRequestDb } from "@/lib/db";
import { apiScope, notFoundResponse, pdfResponse, unauthorized } from "@/lib/auth/api";
import { COMPANY_COOKIE, VIEW_AS_COOKIE } from "@/lib/auth/session";
import { statement } from "@/lib/services/reports";
import { getSettings } from "@/lib/services/settings";
import { csvResponse, toCsv } from "@/lib/csv";
import { formatDate, isDateString, today } from "@/lib/dates";
import { formatDecimal, formatMoney } from "@/lib/money";
import { renderBlocksPdf, type Block } from "@/lib/pdf/fallback";
import { slugFileName } from "@/lib/text";

/** Statement export for the client's active company (or the previewed company for admins). */
export async function GET(req: Request, { params }: { params: Promise<{ format: string }> }) {
  return withRequestDb(async () => {
    const scope = await apiScope();
    if (!scope) return unauthorized();
    const jar = await cookies();
    const c = await cols();
    let companyId: ObjectId | undefined;
    if (scope.isAdmin) {
      const v = new URL(req.url).searchParams.get("company") ?? jar.get(VIEW_AS_COOKIE)?.value;
      if (v && ObjectId.isValid(v)) companyId = new ObjectId(v);
    } else {
      const wanted = jar.get(COMPANY_COOKIE)?.value;
      companyId = scope.companyIds.find((id) => id.toHexString() === wanted) ?? scope.companyIds[0];
    }
    if (!companyId) return notFoundResponse();
    const company = await c.companies.findOne({ _id: companyId });
    if (!company) return notFoundResponse();
    const sp = new URL(req.url).searchParams;
    const from = sp.get("from") && isDateString(sp.get("from")!) ? sp.get("from")! : undefined;
    const to = sp.get("to") && isDateString(sp.get("to")!) ? sp.get("to")! : undefined;
    const data = await statement([companyId], from, to);
    const { format } = await params;
    const name = `Statement_${slugFileName(company.name)}_${today()}`;

    if (format === "csv") {
      const rows: (string | number)[][] = [["Currency", "Date", "Reference", "Description", "Charges", "Payments", "Balance"]];
      for (const [cur, s] of Object.entries(data)) {
        if (from) rows.push([cur, from, "", "Opening balance", "", "", formatDecimal(s.opening).replace(/,/g, "")]);
        for (const l of s.lines) rows.push([cur, l.date, l.ref, l.description, l.debit ? formatDecimal(l.debit).replace(/,/g, "") : "", l.credit ? formatDecimal(l.credit).replace(/,/g, "") : "", formatDecimal(l.balance).replace(/,/g, "")]);
      }
      return csvResponse(toCsv(rows), `${name}.csv`);
    }
    if (format === "pdf") {
      const s = await getSettings();
      const blocks: Block[] = [
        { type: "header", title: "Statement", subtitle: s.legalName, meta: [["Company", company.name], ["Period", `${from ? formatDate(from) : "Start"} to ${to ? formatDate(to) : formatDate(today())}`], ["Issued", formatDate(today())]] },
      ];
      for (const [cur, st] of Object.entries(data)) {
        blocks.push({ type: "heading", text: `${cur} account` });
        blocks.push({
          type: "table",
          columns: [{ label: "Date", width: 14 }, { label: "Reference / description", width: 38 }, { label: "Charges", width: 16, align: "right" }, { label: "Payments", width: 16, align: "right" }, { label: "Balance", width: 16, align: "right" }],
          rows: [
            ...(from ? [{ cells: [formatDate(from), "Opening balance", "", "", formatMoney(st.opening, cur)] }] : []),
            ...st.lines.map((l) => ({ cells: [formatDate(l.date), `${l.ref} ${l.description}`, l.debit ? formatMoney(l.debit, cur) : "", l.credit ? formatMoney(l.credit, cur) : "", formatMoney(l.balance, cur)] })),
          ],
        });
        blocks.push({ type: "totals", rows: [{ label: "Closing balance", value: formatMoney(st.closing, cur), strong: true }] });
      }
      const bytes = await renderBlocksPdf(blocks, { footer: `${s.legalName} · Statement for ${company.name}`, title: "Statement" });
      return pdfResponse(bytes, `${name}.pdf`);
    }
    return notFoundResponse();
  });
}
