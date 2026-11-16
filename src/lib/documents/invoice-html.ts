import { escapeHtml as e } from "../text";
import { formatDate } from "../dates";
import { formatMoney, formatQty, formatRate } from "../money";
import { displayStatus } from "../invoice-status";
import { BRAND, DOC_FONT_LINK, logoSvg } from "./brand";
import type { CompanyDoc, InvoiceDoc, SettingsDoc, UserDoc } from "../types";

export interface InvoiceDocData {
  invoice: InvoiceDoc;
  company: CompanyDoc;
  contact?: Pick<UserDoc, "name" | "email"> | null;
  settings: SettingsDoc;
  today: string;
}

const STATUS_BADGE: Record<string, { label: string; fg: string; bg: string }> = {
  draft: { label: "Draft", fg: "#374151", bg: "#F3F4F6" },
  due: { label: "Due", fg: "#1F2128", bg: "#F3F4F6" },
  partially_paid: { label: "Partially paid", fg: "#92400E", bg: "#FEF3C7" },
  paid: { label: "Paid", fg: "#065F46", bg: "#D1FAE5" },
  overdue: { label: "Overdue", fg: "#991B1B", bg: "#FEE2E2" },
  void: { label: "Void", fg: "#374151", bg: "#E5E7EB" },
};

export function invoiceBadge(inv: InvoiceDoc, today: string) {
  const s = displayStatus(inv, today);
  if (s === "sent" || s === "viewed") return STATUS_BADGE.due;
  return STATUS_BADGE[s] ?? STATUS_BADGE.due;
}

function rows(pairs: [string, string | undefined | null][]): string {
  return pairs
    .filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== "")
    .map(([k, v]) => `<tr><td class="k">${e(k)}</td><td class="v">${e(String(v))}</td></tr>`)
    .join("");
}

function lines(values: (string | undefined | null)[]): string {
  return values.filter((v) => v && v.trim()).map((v) => `<div>${e(v!)}</div>`).join("");
}

/** The invoice document. Used for the on-screen preview and, through Browser Run, for the PDF. */
export function renderInvoiceHtml({ invoice: inv, company, contact, settings: s, today }: InvoiceDocData): string {
  const badge = invoiceBadge(inv, today);
  const money = (n: number) => formatMoney(n, inv.currency);
  const isPaid = inv.status === "paid";
  const isVoid = inv.status === "void";

  const items = inv.items
    .map((it, i) => {
      const details = (it.detail || "").split("\n").map((l) => l.trim()).filter(Boolean);
      return `<tr class="item">
        <td class="num">${i + 1}</td>
        <td class="desc"><div class="t">${e(it.title)}</div>${it.period ? `<div class="d">Period: ${e(it.period)}</div>` : ""}${details.map((d) => `<div class="d">${e(d)}</div>`).join("")}</td>
        <td class="r">${e(formatQty(it.qty100))}</td>
        <td class="r">${e(formatMoney(it.unitPrice, inv.currency))}</td>
        <td class="r">${e(formatMoney(it.amount, inv.currency))}</td>
      </tr>`;
    })
    .join("");

  const totalsRows = [
    `<tr><td>Subtotal</td><td class="r">${e(money(inv.subtotal))}</td></tr>`,
    inv.discountTotal > 0
      ? `<tr><td>Discount${inv.discount.type === "percent" ? ` (${e(formatRate(inv.discount.value))})` : ""}</td><td class="r">-${e(money(inv.discountTotal))}</td></tr>`
      : "",
    inv.tax.rateBp > 0 ? `<tr><td>${e(inv.tax.label || "Tax")} (${e(formatRate(inv.tax.rateBp))})</td><td class="r">${e(money(inv.taxTotal))}</td></tr>` : "",
    `<tr class="total"><td>Total</td><td class="r">${e(money(inv.total))}</td></tr>`,
    inv.paidTotal > 0 ? `<tr><td>Amount paid</td><td class="r">-${e(money(inv.paidTotal))}</td></tr>` : "",
  ].join("");

  const bank = rows([
    ["Bank", s.bank.bankName],
    ["Branch", s.bank.branch],
    ["Account name", s.bank.accountName],
    ["Account number", s.bank.accountNumber],
    ["SWIFT code", s.bank.swift],
  ]);

  const from = lines([
    s.address,
    s.phone,
    s.email,
    s.website,
    s.registrationNumber ? `Reg. No: ${s.registrationNumber}` : "",
    s.taxNumber ? `Tax No: ${s.taxNumber}` : "",
  ]);

  const billTo = lines([
    contact?.name ? `Attn: ${contact.name}` : "",
    company.billingAddress,
    [company.city, company.country].filter(Boolean).join(", "),
    contact?.email,
    company.taxNumber ? `Tax No: ${company.taxNumber}` : "",
  ]);

  const notes = [inv.notes, inv.paymentInstructions].filter((n) => n && n.trim());

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${e(inv.number)}</title>${DOC_FONT_LINK}
<style>
@page { size: A4; margin: 18mm 16mm 20mm 16mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: Inter, "Segoe UI", Arial, sans-serif; color: ${BRAND.ink}; font-size: 10pt; line-height: 1.45; background: #fff; font-variant-numeric: tabular-nums; }
.page { position: relative; }
.screen .page { max-width: 794px; margin: 0 auto; padding: 56px 60px 48px; }
.screen .stamp { top: 80px; }
.topbar { height: 4px; background: ${BRAND.red}; margin-bottom: 22px; }
.head { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; }
.brand-name { font-weight: 800; font-size: 13pt; margin-top: 6px; }
.brand-tag { color: ${BRAND.muted}; font-size: 8pt; }
.title { text-align: right; }
.title h1 { margin: 0; font-size: 22pt; font-weight: 800; letter-spacing: -0.3px; }
.title table { margin-left: auto; margin-top: 6px; border-collapse: collapse; }
.title td { padding: 1px 0 1px 14px; font-size: 9.5pt; }
.title td.k { color: ${BRAND.muted}; text-align: right; }
.title td.v { text-align: right; font-weight: 600; }
.badge { display: inline-block; margin-top: 8px; padding: 3px 10px; border-radius: 999px; font-size: 8.5pt; font-weight: 700; color: ${badge.fg}; background: ${badge.bg}; }
.parties { display: flex; gap: 32px; margin-top: 28px; }
.parties > div { flex: 1; }
.label { font-size: 7.5pt; letter-spacing: 0.8px; text-transform: uppercase; color: ${BRAND.red}; font-weight: 700; margin-bottom: 4px; }
.party-name { font-weight: 700; font-size: 10.5pt; }
.muted { color: ${BRAND.muted}; }
.period { margin-top: 18px; padding: 8px 12px; background: ${BRAND.soft}; border-left: 3px solid ${BRAND.red}; font-size: 9.5pt; }
table.items { width: 100%; border-collapse: collapse; margin-top: 22px; }
table.items thead { display: table-header-group; }
table.items th { text-align: left; font-size: 8pt; text-transform: uppercase; letter-spacing: 0.6px; color: ${BRAND.muted}; font-weight: 700; padding: 8px 8px; border-bottom: 1.5px solid ${BRAND.ink}; }
table.items td { padding: 10px 8px; border-bottom: 1px solid ${BRAND.line}; vertical-align: top; }
table.items tr.item { page-break-inside: avoid; break-inside: avoid; }
table.items .num { width: 28px; color: ${BRAND.muted}; }
table.items .t { font-weight: 600; }
table.items .d { color: ${BRAND.muted}; font-size: 9pt; }
.r { text-align: right; white-space: nowrap; }
table.items th.r { text-align: right; }
.bottom { display: flex; justify-content: space-between; gap: 32px; margin-top: 18px; page-break-inside: avoid; break-inside: avoid; }
.pay { flex: 1; }
.pay table { border-collapse: collapse; margin-top: 2px; }
.pay td { padding: 2px 14px 2px 0; font-size: 9.5pt; }
.pay td.k { color: ${BRAND.muted}; }
.pay td.v { font-weight: 600; }
.ref { margin-top: 8px; font-size: 9pt; }
.totals { width: 300px; }
.totals table { width: 100%; border-collapse: collapse; }
.totals td { padding: 5px 0; font-size: 10pt; }
.totals tr.total td { border-top: 1px solid ${BRAND.line}; font-weight: 700; padding-top: 8px; }
.balance { margin-top: 8px; border-top: 2px solid ${BRAND.red}; padding-top: 10px; display: flex; justify-content: space-between; align-items: baseline; }
.balance .l { font-weight: 700; font-size: 10.5pt; }
.balance .a { font-weight: 800; font-size: 16pt; color: ${BRAND.red}; }
.notes { margin-top: 24px; font-size: 9.5pt; page-break-inside: avoid; break-inside: avoid; }
.notes p { margin: 0 0 6px; white-space: pre-line; }
.thanks { margin-top: 18px; font-weight: 600; }
.foot { margin-top: 28px; padding-top: 10px; border-top: 1px solid ${BRAND.line}; font-size: 8pt; color: ${BRAND.muted}; text-align: center; }
.stamp { position: absolute; top: 30px; left: 40%; transform: rotate(-12deg); border: 3px solid; border-radius: 8px; padding: 6px 16px; font-weight: 900; font-size: 26pt; letter-spacing: 3px; opacity: 0.85; text-align: center; line-height: 1.1; }
.stamp small { display: block; font-size: 8pt; letter-spacing: 0.5px; font-weight: 700; }
.stamp.paid { color: #059669; border-color: #059669; }
.stamp.void { color: #6B7280; border-color: #6B7280; }
</style></head><body class="${"__MODE__"}"><div class="page">
<div class="topbar"></div>
${isPaid ? `<div class="stamp paid">PAID${inv.lastPaymentDate ? `<small>${e(formatDate(inv.lastPaymentDate))}</small>` : ""}</div>` : ""}
${isVoid ? `<div class="stamp void">VOID</div>` : ""}
<div class="head">
  <div>${logoSvg(46)}<div class="brand-name">${e(s.legalName)}</div><div class="brand-tag">Digital Marketing &amp; Web Development</div></div>
  <div class="title">
    <h1>Invoice</h1>
    <table>${rows([["Invoice no.", inv.number], ["Issue date", formatDate(inv.issueDate)], ["Due date", formatDate(inv.dueDate)]])}</table>
    <span class="badge">${e(badge.label)}</span>
  </div>
</div>
<div class="parties">
  <div><div class="label">From</div><div class="party-name">${e(s.legalName)}</div><div class="muted">${from}</div></div>
  <div><div class="label">Bill to</div><div class="party-name">${e(company.name)}</div><div class="muted">${billTo}</div></div>
</div>
${inv.billingPeriod ? `<div class="period"><strong>Billing period:</strong> ${e(inv.billingPeriod)}</div>` : ""}
<table class="items">
  <thead><tr><th class="num">#</th><th>Description</th><th class="r">Qty</th><th class="r">Unit price</th><th class="r">Amount</th></tr></thead>
  <tbody>${items}</tbody>
</table>
<div class="bottom">
  <div class="pay">
    ${bank ? `<div class="label">Payment details</div><table>${bank}</table><div class="ref">Use the invoice number <strong>${e(inv.number)}</strong> as your payment reference.</div>` : `<div class="ref">Please use the invoice number <strong>${e(inv.number)}</strong> as your payment reference.</div>`}
  </div>
  <div class="totals">
    <table>${totalsRows}</table>
    <div class="balance"><span class="l">Balance due</span><span class="a">${e(money(inv.balance))}</span></div>
  </div>
</div>
${notes.length ? `<div class="notes"><div class="label">Notes</div>${notes.map((n) => `<p>${e(n!)}</p>`).join("")}</div>` : ""}
${isVoid && inv.voidReason ? `<div class="notes"><div class="label">Void reason</div><p>${e(inv.voidReason)}</p></div>` : ""}
${s.invoiceThankYou ? `<div class="thanks">${e(s.invoiceThankYou)}</div>` : ""}
<div class="foot">${e([s.legalName, s.address, s.phone, s.email, s.website].filter(Boolean).join("  ·  "))}</div>
</div></body></html>`;
}

export function forScreen(html: string): string {
  return html.replace('class="__MODE__"', 'class="screen"');
}

export function forPrint(html: string): string {
  return html.replace('class="__MODE__"', 'class="print"');
}
