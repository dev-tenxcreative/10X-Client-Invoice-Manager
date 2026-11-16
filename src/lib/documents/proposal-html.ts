import { escapeHtml as e, richTextToHtml } from "../text";
import { formatDate, formatDateTime } from "../dates";
import { formatMoney, formatQty, formatRate, splitByMilestones } from "../money";
import { BRAND, DOC_FONT_LINK, logoSvg } from "./brand";
import { TABLE_SECTIONS } from "./proposal-templates";
import type { CompanyDoc, ProposalContent, ProposalDoc, SettingsDoc, Totals } from "../types";

export interface ProposalDocData {
  proposal: Pick<ProposalDoc, "reference" | "status" | "version" | "acceptance">;
  content: ProposalContent;
  totals: Totals;
  company: CompanyDoc;
  contactName?: string;
  settings: SettingsDoc;
}

export function proposalHeaderLine(d: Pick<ProposalDocData, "proposal" | "company">) {
  return `${d.proposal.reference}  ·  ${d.company.name}  ·  Confidential`;
}

/** Rough page estimate used to decide whether a table of contents is needed (> 6 pages). */
function estimatePages(c: ProposalContent): number {
  const chars = c.sections.filter((s) => !s.hidden).reduce((n, s) => n + s.body.length, 0);
  const rows = c.investment.length + c.timeline.length + c.paymentSchedule.length;
  return 2 + Math.ceil(chars / 2800 + rows / 22 + c.sections.filter((s) => !s.hidden).length * 0.15);
}

export function renderProposalHtml(d: ProposalDocData, mode: "screen" | "print" = "print"): string {
  const { content: c, totals: t, company, settings: s, proposal: p } = d;
  const money = (n: number) => formatMoney(n, c.currency);
  const visible = c.sections.filter((x) => !x.hidden);
  const showToc = estimatePages(c) > 6;

  const investmentTable = `<table class="grid">
    <thead><tr><th style="width:28px">#</th><th>Module</th><th>Description</th><th class="r">Qty</th><th class="r">Amount</th></tr></thead>
    <tbody>${c.investment.map((i, n) => `<tr><td class="muted">${n + 1}</td><td><strong>${e(i.title)}</strong></td><td>${e(i.detail ?? "").replace(/\n/g, "<br>")}</td><td class="r">${e(formatQty(i.qty100))}</td><td class="r">${e(money(i.amount))}</td></tr>`).join("")}</tbody>
  </table>
  <table class="sum">
    <tr><td>Subtotal</td><td class="r">${e(money(t.subtotal))}</td></tr>
    ${t.discountTotal > 0 ? `<tr><td>Discount${c.discount.type === "percent" ? ` (${e(formatRate(c.discount.value))})` : ""}</td><td class="r">-${e(money(t.discountTotal))}</td></tr>` : ""}
    ${c.tax.rateBp > 0 ? `<tr><td>${e(c.tax.label || "Tax")} (${e(formatRate(c.tax.rateBp))})</td><td class="r">${e(money(t.taxTotal))}</td></tr>` : ""}
    <tr class="tot"><td>Total</td><td class="r">${e(money(t.total))}</td></tr>
  </table>
  ${c.investmentNotes ? `<div class="notes">${c.investmentNotes.split("\n").filter(Boolean).map((l) => `<div>${e(l)}</div>`).join("")}</div>` : ""}`;

  const amounts = splitByMilestones(t.total, c.paymentSchedule);
  const scheduleTable = c.paymentSchedule.length
    ? `<table class="grid"><thead><tr><th style="width:28px">#</th><th>Milestone</th><th class="r">Share</th><th class="r">Amount</th><th>When</th></tr></thead><tbody>
      ${c.paymentSchedule.map((m, n) => `<tr><td class="muted">${n + 1}</td><td>${e(m.label)}</td><td class="r">${m.type === "percent" ? e(formatRate(m.value)) : ""}</td><td class="r">${e(money(amounts[n]))}</td><td>${e(m.dueNote ?? "")}</td></tr>`).join("")}
      </tbody></table>`
    : "";

  const timelineTable = c.timeline.length
    ? `<table class="grid"><thead><tr><th style="width:28px">#</th><th>Phase or milestone</th><th>Duration</th><th>Notes</th></tr></thead><tbody>
      ${c.timeline.map((r, n) => `<tr><td class="muted">${n + 1}</td><td>${e(r.phase)}</td><td>${e(r.duration)}</td><td>${e(r.notes ?? "")}</td></tr>`).join("")}
      </tbody></table>`
    : "";

  const tableFor: Record<string, string> = { investment: investmentTable, payment_schedule: scheduleTable, timeline: timelineTable };

  const acc = p.acceptance;
  const sections = visible
    .map((sec, i) => {
      const n = i + 1;
      let inner = sec.body ? `<div class="rich">${richTextToHtml(sec.body)}</div>` : "";
      if (TABLE_SECTIONS.has(sec.key)) inner += tableFor[sec.key] ?? "";
      if (sec.key === "acceptance") {
        inner += `<div class="sign">
          <div class="sig"><div class="label">For the client: ${e(company.name)}</div>
            ${acc ? `<div class="accepted">Accepted ${acc.method === "online" ? "online" : "(signed copy on file)"}</div>
              <table class="kv"><tr><td>Name</td><td>${e(acc.name)}</td></tr><tr><td>Designation</td><td>${e(acc.designation)}</td></tr><tr><td>Date</td><td>${e(formatDateTime(acc.at))}</td></tr></table>`
              : `<div class="line"></div><div class="cap">Signature</div><div class="line"></div><div class="cap">Name and designation</div><div class="line"></div><div class="cap">Date</div>`}
          </div>
          <div class="sig"><div class="label">For ${e(s.legalName)}</div>
            <div class="line"></div><div class="cap">Signature</div>
            <div class="signame">${e(s.signatoryName)}</div><div class="cap">${e(s.signatoryTitle)}</div>
            <div class="line"></div><div class="cap">Date</div>
          </div></div>`;
      }
      return `<section class="sec${sec.key === "acceptance" || sec.key === "terms" ? " newpage" : ""}" id="s-${e(sec.key)}"><h2><span class="n">${n}.</span> ${e(sec.title)}</h2>${inner}</section>`;
    })
    .join("");

  const acceptanceRecord = acc && acc.method === "online"
    ? `<section class="sec newpage"><h2>Digital acceptance record</h2>
        <p>This proposal was accepted online through the 10X Creative client portal.</p>
        <table class="kv big">
          <tr><td>Proposal</td><td>${e(p.reference)} (version ${acc.version})</td></tr>
          <tr><td>Accepted by</td><td>${e(acc.name)}</td></tr>
          <tr><td>Designation</td><td>${e(acc.designation)}</td></tr>
          <tr><td>Company</td><td>${e(company.name)}</td></tr>
          <tr><td>Date and time</td><td>${e(formatDateTime(acc.at))} (Asia/Colombo)</td></tr>
          ${acc.ip ? `<tr><td>IP address</td><td>${e(acc.ip)}</td></tr>` : ""}
          <tr><td>Confirmation</td><td>Ticked "I agree to this proposal and its terms"</td></tr>
        </table></section>`
    : "";

  const toc = showToc
    ? `<section class="toc newpage"><h2>Contents</h2><ol>${visible.map((x) => `<li>${e(x.title)}</li>`).join("")}</ol></section>`
    : "";

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${e(p.reference)}</title>${DOC_FONT_LINK}
<style>
@page { size: A4; margin: 20mm 18mm 20mm 18mm; }
* { box-sizing: border-box; }
body { margin: 0; font-family: Inter, "Segoe UI", Arial, sans-serif; color: ${BRAND.ink}; font-size: 10.5pt; line-height: 1.55; background: #fff; font-variant-numeric: tabular-nums; }
.screen .wrap { max-width: 794px; margin: 0 auto; padding: 48px 60px; }
.screen .newpage { margin-top: 40px; padding-top: 32px; border-top: 1px dashed ${BRAND.line}; }
.print .newpage { break-before: page; }
.cover { min-height: ${mode === "print" ? "240mm" : "auto"}; display: flex; flex-direction: column; }
.cover .rule { height: 3px; width: 64px; background: ${BRAND.red}; margin: 36px 0 18px; }
.cover h1 { font-size: 22pt; font-weight: 700; margin: 0 0 6px; letter-spacing: -0.2px; }
.cover .project { font-size: 13pt; color: ${BRAND.muted}; margin-bottom: 28px; }
.cover table.meta td { padding: 3px 18px 3px 0; font-size: 10pt; }
.cover table.meta td:first-child { color: ${BRAND.muted}; }
.parties { display: flex; gap: 40px; margin-top: auto; padding-top: 40px; }
.parties > div { flex: 1; border-top: 1px solid ${BRAND.line}; padding-top: 10px; font-size: 9.5pt; }
.label { font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.8px; color: ${BRAND.red}; font-weight: 700; margin-bottom: 4px; }
h2 { font-size: 13pt; font-weight: 700; margin: 0 0 10px; padding-bottom: 6px; border-bottom: 1px solid ${BRAND.line}; }
h2 .n { color: ${BRAND.red}; margin-right: 4px; }
.sec { margin-bottom: 22px; }
.rich p { margin: 0 0 8px; }
.rich ul, .rich ol { margin: 0 0 8px 0; padding-left: 20px; }
.rich li { margin-bottom: 3px; }
.rich a { color: ${BRAND.red}; }
table.grid { width: 100%; border-collapse: collapse; margin: 8px 0; font-size: 9.5pt; }
table.grid thead { display: table-header-group; }
table.grid th { text-align: left; font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.6px; color: ${BRAND.muted}; border-bottom: 1.5px solid ${BRAND.ink}; padding: 6px; }
table.grid td { border-bottom: 1px solid ${BRAND.line}; padding: 7px 6px; vertical-align: top; }
table.grid tr { break-inside: avoid; }
.r { text-align: right; white-space: nowrap; }
th.r { text-align: right; }
.muted { color: ${BRAND.muted}; }
table.sum { margin-left: auto; width: 280px; border-collapse: collapse; margin-top: 6px; font-size: 10pt; }
table.sum td { padding: 4px 0; }
table.sum tr.tot td { border-top: 2px solid ${BRAND.red}; font-weight: 800; font-size: 12pt; padding-top: 8px; }
.notes { margin-top: 10px; font-size: 9pt; color: ${BRAND.muted}; }
.notes div::before { content: "Note: "; font-weight: 600; }
.toc ol { padding-left: 20px; } .toc li { margin: 4px 0; }
.sign { display: flex; gap: 32px; margin-top: 22px; break-inside: avoid; }
.sig { flex: 1; border: 1px solid ${BRAND.line}; border-radius: 6px; padding: 14px; }
.sig .line { border-bottom: 1px solid ${BRAND.ink}; height: 34px; }
.sig .cap { font-size: 8pt; color: ${BRAND.muted}; margin-top: 3px; }
.sig .signame { margin-top: 6px; font-weight: 600; }
.accepted { color: #065F46; font-weight: 700; margin: 6px 0; }
table.kv td { padding: 3px 14px 3px 0; font-size: 9.5pt; } table.kv td:first-child { color: ${BRAND.muted}; }
table.kv.big td { padding: 6px 18px 6px 0; font-size: 10.5pt; }
</style></head><body class="${mode}"><div class="wrap">
<section class="cover">
  <div>${logoSvg(52)}</div>
  <div class="rule"></div>
  <h1>Proposal for ${e(company.name)}</h1>
  ${c.projectTitle ? `<div class="project">${e(c.projectTitle)}</div>` : ""}
  <table class="meta">
    <tr><td>Reference</td><td>${e(p.reference)}${p.version > 1 ? ` (version ${p.version})` : ""}</td></tr>
    <tr><td>Date</td><td>${e(formatDate(c.date))}</td></tr>
    <tr><td>Valid until</td><td>${e(formatDate(c.validUntil))}</td></tr>
    <tr><td>Total investment</td><td><strong>${e(money(t.total))}</strong></td></tr>
  </table>
  <div class="parties">
    <div><div class="label">Prepared for</div><strong>${e(company.name)}</strong>${d.contactName ? `<div>Attn: ${e(d.contactName)}</div>` : ""}<div class="muted">${e([company.billingAddress, company.city, company.country].filter(Boolean).join(", "))}</div></div>
    <div><div class="label">Prepared by</div><strong>${e(s.legalName)}</strong><div>${e(s.signatoryName)}, ${e(s.signatoryTitle)}</div><div class="muted">${e([s.address, s.phone, s.website].filter(Boolean).join(" · "))}</div></div>
  </div>
</section>
${toc}
<div class="newpage">${sections}</div>
${acceptanceRecord}
</div></body></html>`;
}
