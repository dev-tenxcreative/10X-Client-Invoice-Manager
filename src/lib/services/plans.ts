import { ObjectId, MongoServerError } from "mongodb";
import { cols } from "../db";
import { appUrl } from "../env";
import { AppError, NotFoundError } from "../errors";
import { computeTotals, formatMoney, normaliseItems } from "../money";
import { addDays, billingDate, formatDate, isDateString, nextPeriod, periodLabel, periodOf, today } from "../dates";
import { duePeriods, nextBillingDate } from "../schedule";
import { adminEmails, sendEmail } from "../email";
import { audit, type Actor } from "./audit";
import { createGeneratedInvoice, sendInvoice } from "./invoices";
import type { Currency, Discount, InvoiceDoc, LineItem, RecurringPlanDoc, Tax } from "../types";

export interface PlanInput {
  companyId: ObjectId;
  name: string;
  items: Omit<LineItem, "amount">[];
  currency: Currency;
  discount: Discount;
  tax: Tax;
  startDate: string;
  billingDay: number;
  dueAfterDays: number;
  endDate?: string;
  mode: "auto" | "review";
  notes?: string;
}

function validate(input: PlanInput) {
  if (!input.name.trim()) throw new AppError("Please name the plan.", "name");
  if (!isDateString(input.startDate)) throw new AppError("Please enter a valid start date.", "startDate");
  if (input.endDate && !isDateString(input.endDate)) throw new AppError("Please enter a valid end date.", "endDate");
  if (input.endDate && input.endDate < input.startDate) throw new AppError("The end date cannot be before the start date.", "endDate");
  if (!Number.isInteger(input.billingDay) || input.billingDay < 1 || input.billingDay > 28) throw new AppError("Billing day must be between 1 and 28.", "billingDay");
  if (!Number.isInteger(input.dueAfterDays) || input.dueAfterDays < 0 || input.dueAfterDays > 120) throw new AppError("Due after must be between 0 and 120 days.", "dueAfterDays");
  if (input.items.length === 0) throw new AppError("Add at least one line item.", "items");
  const items = normaliseItems(input.items);
  computeTotals(items, input.discount, input.tax);
  return items;
}

export async function createPlan(actor: Actor, input: PlanInput, extra: { proposalId?: ObjectId; isDemo?: boolean } = {}) {
  const items = validate(input);
  const c = await cols();
  const company = await c.companies.findOne({ _id: input.companyId });
  if (!company) throw new AppError("Please choose a company.", "companyId");
  const now = new Date();
  const plan: RecurringPlanDoc = {
    _id: new ObjectId(),
    ...input,
    name: input.name.trim(),
    items,
    notes: input.notes?.trim() || undefined,
    status: "active",
    skippedPeriods: [],
    createdBy: actor.userId,
    createdAt: now,
    updatedAt: now,
    ...extra,
  };
  await c.recurringPlans.insertOne(plan);
  await audit(actor, "plan.create", "plan", plan._id, undefined, { name: plan.name, company: company.name });
  return plan;
}

/** Edits affect future invoices only; invoices already created keep their own copy. */
export async function updatePlan(actor: Actor, id: ObjectId, input: PlanInput) {
  const items = validate(input);
  const c = await cols();
  const before = await c.recurringPlans.findOne({ _id: id });
  if (!before) throw new NotFoundError("Plan not found.");
  await c.recurringPlans.updateOne({ _id: id }, { $set: { ...input, name: input.name.trim(), items, notes: input.notes?.trim() || undefined, updatedAt: new Date() } });
  await audit(actor, "plan.update", "plan", id, before, input);
}

export async function setPlanStatus(actor: Actor, id: ObjectId, status: RecurringPlanDoc["status"]) {
  const c = await cols();
  await c.recurringPlans.updateOne({ _id: id }, { $set: { status, updatedAt: new Date() } });
  await audit(actor, `plan.${status}`, "plan", id);
}

export async function skipPeriod(actor: Actor, id: ObjectId, period: string, skip: boolean) {
  if (!/^\d{4}-\d{2}$/.test(period)) throw new AppError("Invalid month.");
  const c = await cols();
  await c.recurringPlans.updateOne({ _id: id }, skip ? { $addToSet: { skippedPeriods: period } } : { $pull: { skippedPeriods: period } });
  await audit(actor, skip ? "plan.skip_month" : "plan.unskip_month", "plan", id, undefined, { period });
}

export async function invoicedPeriods(planId: ObjectId): Promise<Set<string>> {
  const c = await cols();
  const rows = await c.invoices.find({ planId }, { projection: { period: 1 } }).toArray();
  return new Set(rows.map((r) => r.period!).filter(Boolean));
}

export function planTotals(plan: RecurringPlanDoc) {
  return computeTotals(plan.items, plan.discount, plan.tax);
}

export async function planNext(plan: RecurringPlanDoc) {
  const invoiced = await invoicedPeriods(plan._id);
  const date = nextBillingDate(plan, today(), invoiced);
  return { date, amount: planTotals(plan).total };
}

function systemActor(plan: RecurringPlanDoc): Actor {
  return { userId: plan.createdBy, email: "system", role: "admin", name: "Scheduled job" };
}

/**
 * Creates the invoice for one plan period. The unique index on {planId, period} guarantees
 * one invoice per month even if two job runs race. Returns null if it already exists.
 */
export async function generatePlanInvoice(plan: RecurringPlanDoc, period: string, actor?: Actor): Promise<InvoiceDoc | null> {
  const c = await cols();
  if (await c.invoices.findOne({ planId: plan._id, period })) return null;
  const issue = today();
  const label = periodLabel(period);
  let inv: InvoiceDoc;
  try {
    inv = await createGeneratedInvoice(
      actor ?? systemActor(plan),
      {
        companyId: plan.companyId,
        issueDate: issue,
        dueDate: addDays(issue, plan.dueAfterDays),
        currency: plan.currency,
        items: plan.items.map(({ amount: _a, ...i }) => ({ ...i, period: i.period || label })),
        discount: plan.discount,
        tax: plan.tax,
        notes: plan.notes,
        billingPeriod: label,
        remindersEnabled: true,
      },
      { planId: plan._id, period, isDemo: plan.isDemo },
    );
  } catch (e) {
    if (e instanceof MongoServerError && e.code === 11000) return null;
    throw e;
  }
  await c.recurringPlans.updateOne({ _id: plan._id }, { $set: { lastRunAt: new Date() } });
  const company = await c.companies.findOne({ _id: plan.companyId });
  if (plan.mode === "auto") {
    await sendInvoice(actor ?? systemActor(plan), inv._id);
  } else {
    const admins = await adminEmails();
    if (admins.length) {
      await sendEmail({
        template: "plan_draft_admin",
        to: admins,
        vars: { plan_name: plan.name, company_name: company?.name, invoice_number: inv.number, amount_due: formatMoney(inv.total, inv.currency), action_link: appUrl(`/admin/invoices/${inv._id}`) },
        related: { type: "invoice", id: inv._id },
      });
    }
  }
  return inv;
}

/** Daily job step: every active plan, every due period. Safe to run twice. */
export async function runRecurringPlans(t = today()) {
  const c = await cols();
  const plans = await c.recurringPlans.find({ status: "active" }).toArray();
  let created = 0;
  const errors: string[] = [];
  for (const plan of plans) {
    try {
      const company = await c.companies.findOne({ _id: plan.companyId });
      if (!company || company.status === "archived") continue;
      if (plan.endDate && plan.endDate < t) {
        await c.recurringPlans.updateOne({ _id: plan._id }, { $set: { status: "ended" } });
      }
      const periods = duePeriods(plan, t, await invoicedPeriods(plan._id));
      for (const p of periods) if (await generatePlanInvoice(plan, p)) created++;
    } catch (e) {
      console.error(`[job] plan ${plan._id} failed`, e);
      errors.push(`${plan.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { plans: plans.length, created, errors };
}

/** "Run now": creates the earliest month not yet invoiced, up to and including this month. */
export async function runPlanNow(actor: Actor, id: ObjectId) {
  const c = await cols();
  const plan = await c.recurringPlans.findOne({ _id: id });
  if (!plan) throw new NotFoundError("Plan not found.");
  if (plan.status !== "active") throw new AppError("Only active plans can run.");
  const invoiced = await invoicedPeriods(plan._id);
  const current = periodOf(today());
  for (let p = periodOf(plan.startDate); p <= current; p = nextPeriod(p)) {
    if (plan.endDate && billingDate(p, plan.billingDay) > plan.endDate) break;
    if (invoiced.has(p) || plan.skippedPeriods.includes(p)) continue;
    const inv = await generatePlanInvoice(plan, p, actor);
    if (inv) {
      await audit(actor, "plan.run_now", "plan", plan._id, undefined, { period: p, invoice: inv.number });
      return inv;
    }
  }
  throw new AppError(`There is nothing to create yet. This month (${formatDate(billingDate(current, plan.billingDay))}) is already invoiced or skipped.`);
}
