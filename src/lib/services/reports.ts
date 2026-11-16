import { ObjectId } from "mongodb";
import { cols } from "../db";
import { addDays, diffDays, periodOf, today } from "../dates";
import { OPEN_STATUSES, isOverdue } from "../invoice-status";
import { escapeRegex } from "./companies";
import type { InvoiceDoc, PaymentDoc } from "../types";

type ByCurrency = Record<string, number>;
const add = (o: ByCurrency, cur: string, n: number) => ((o[cur] = (o[cur] ?? 0) + n), o);

export async function adminDashboard() {
  const c = await cols();
  const t = today();
  const in7 = addDays(t, 7);
  const monthStart = `${periodOf(t)}-01`;
  const open = await c.invoices.find({ status: { $in: OPEN_STATUSES }, balance: { $gt: 0 } }).toArray();
  const outstanding: ByCurrency = {}, overdue: ByCurrency = {}, dueSoon: ByCurrency = {}, collected: ByCurrency = {};
  for (const i of open) {
    add(outstanding, i.currency, i.balance);
    if (isOverdue(i, t)) add(overdue, i.currency, i.balance);
    else if (i.dueDate <= in7) add(dueSoon, i.currency, i.balance);
  }
  const payments = await c.payments.find({ date: { $gte: monthStart, $lte: t } }).toArray();
  for (const p of payments) add(collected, p.currency, p.amount);

  const [drafts, slips, failedEmails, followUps, plans, activity, companies] = await Promise.all([
    c.invoices.find({ status: "draft" }).sort({ createdAt: -1 }).limit(10).toArray(),
    c.paymentSubmissions.find({ status: "pending" }).sort({ createdAt: 1 }).limit(10).toArray(),
    c.emailLogs.find({ status: "failed" }).sort({ createdAt: -1 }).limit(10).toArray(),
    c.invoices.find({ followUp: true, status: { $in: OPEN_STATUSES } }).limit(10).toArray(),
    c.recurringPlans.find({ status: "active" }).toArray(),
    c.auditLogs.find({ action: { $not: /^auth\.|^job\./ } }).sort({ at: -1 }).limit(12).toArray(),
    c.companies.find({}, { projection: { name: 1 } }).toArray(),
  ]);
  const companyName = new Map(companies.map((co) => [co._id.toHexString(), co.name]));
  const slipInvoices = await c.invoices.find({ _id: { $in: slips.map((s) => s.invoiceId) } }, { projection: { number: 1 } }).toArray();
  return { outstanding, overdue, dueSoon, collected, drafts, slips, slipInvoices, failedEmails, followUps, plans, activity, companyName };
}

export async function revenueByMonth(months = 12) {
  const c = await cols();
  const t = today();
  const from = addDays(`${periodOf(t)}-01`, -31 * (months - 1)).slice(0, 7) + "-01";
  const payments = await c.payments.find({ date: { $gte: from } }).toArray();
  const invoices = await c.invoices.find({ issueDate: { $gte: from }, status: { $nin: ["draft", "void"] } }).toArray();
  const rows = new Map<string, { period: string; currency: string; billed: number; collected: number }>();
  const key = (p: string, cur: string) => `${p}|${cur}`;
  for (const i of invoices) {
    const k = key(periodOf(i.issueDate), i.currency);
    const r = rows.get(k) ?? { period: periodOf(i.issueDate), currency: i.currency, billed: 0, collected: 0 };
    r.billed += i.total;
    rows.set(k, r);
  }
  for (const p of payments) {
    const k = key(periodOf(p.date), p.currency);
    const r = rows.get(k) ?? { period: periodOf(p.date), currency: p.currency, billed: 0, collected: 0 };
    r.collected += p.amount;
    rows.set(k, r);
  }
  return [...rows.values()].sort((a, b) => (a.period === b.period ? a.currency.localeCompare(b.currency) : b.period.localeCompare(a.period)));
}

export const AGING_BUCKETS = ["Not yet due", "0–30 days", "31–60 days", "61–90 days", "Over 90 days"] as const;

export function agingBucket(dueDate: string, t: string): number {
  const d = diffDays(dueDate, t);
  if (d <= 0) return 0;
  if (d <= 30) return 1;
  if (d <= 60) return 2;
  if (d <= 90) return 3;
  return 4;
}

export async function agingReport() {
  const c = await cols();
  const t = today();
  const open = await c.invoices.find({ status: { $in: OPEN_STATUSES }, balance: { $gt: 0 } }).toArray();
  const out: Record<string, number[]> = {};
  for (const i of open) {
    out[i.currency] ??= [0, 0, 0, 0, 0];
    out[i.currency][agingBucket(i.dueDate, t)] += i.balance;
  }
  return out;
}

export async function totalsByCompany() {
  const c = await cols();
  const invoices = await c.invoices.find({ status: { $nin: ["draft", "void"] } }).toArray();
  const companies = await c.companies.find().toArray();
  const t = today();
  const map = new Map<string, { companyId: string; name: string; currency: string; billed: number; paid: number; outstanding: number; overdue: number }>();
  for (const i of invoices) {
    const k = `${i.companyId}|${i.currency}`;
    const co = companies.find((x) => x._id.equals(i.companyId));
    const r = map.get(k) ?? { companyId: i.companyId.toHexString(), name: co?.name ?? "", currency: i.currency, billed: 0, paid: 0, outstanding: 0, overdue: 0 };
    r.billed += i.total;
    r.paid += i.paidTotal;
    r.outstanding += i.balance;
    if (isOverdue(i, t)) r.overdue += i.balance;
    map.set(k, r);
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Statement with running balance, per currency, for a set of companies. */
export async function statement(companyIds: ObjectId[], from?: string, to?: string) {
  const c = await cols();
  const invoices = await c.invoices.find({ companyId: { $in: companyIds }, status: { $nin: ["draft", "void"] } }).toArray();
  const payments = await c.payments.find({ companyId: { $in: companyIds } }).toArray();
  type Line = { date: string; type: "invoice" | "payment"; ref: string; description: string; currency: string; debit: number; credit: number; balance: number; id: string };
  const lines: Line[] = [
    ...invoices.map((i: InvoiceDoc) => ({ date: i.issueDate, type: "invoice" as const, ref: i.number, description: i.billingPeriod ? `Invoice (${i.billingPeriod})` : i.description || "Invoice", currency: i.currency, debit: i.total, credit: 0, balance: 0, id: i._id.toHexString() })),
    ...payments.map((p: PaymentDoc) => ({ date: p.date, type: "payment" as const, ref: invoices.find((i) => i._id.equals(p.invoiceId))?.number ?? "", description: `Payment${p.reference ? ` (${p.reference})` : ""}`, currency: p.currency, debit: 0, credit: p.amount, balance: 0, id: p.invoiceId.toHexString() })),
  ].sort((a, b) => (a.date === b.date ? (a.type === "invoice" ? -1 : 1) : a.date.localeCompare(b.date)));

  const byCurrency: Record<string, { opening: number; lines: Line[]; closing: number }> = {};
  for (const l of lines) {
    const s = (byCurrency[l.currency] ??= { opening: 0, lines: [], closing: 0 });
    const delta = l.debit - l.credit;
    if (from && l.date < from) {
      s.opening += delta;
      s.closing = s.opening;
      continue;
    }
    if (to && l.date > to) continue;
    s.closing += delta;
    s.lines.push({ ...l, balance: s.closing });
  }
  return byCurrency;
}

export async function globalSearch(q: string) {
  const c = await cols();
  const term = q.trim();
  if (term.length < 2) return { companies: [], users: [], invoices: [], proposals: [] };
  const rx = { $regex: escapeRegex(term), $options: "i" };
  const [companies, users, invoices, proposals] = await Promise.all([
    c.companies.find({ name: rx }).limit(10).toArray(),
    c.users.find({ $or: [{ name: rx }, { email: rx }] }, { projection: { passwordHash: 0 } }).limit(10).toArray(),
    c.invoices.find({ number: rx }).limit(10).toArray(),
    c.proposals.find({ $or: [{ reference: rx }, { "content.title": rx }] }).limit(10).toArray(),
  ]);
  return { companies, users, invoices, proposals };
}
