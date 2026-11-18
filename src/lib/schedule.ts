import { billingDate, diffDays, nextPeriod, periodOf } from "./dates";

/* Pure scheduling rules for recurring plans and reminders (unit-tested). */

export interface PlanScheduleInput {
  status: "active" | "paused" | "ended";
  startDate: string;
  billingDay: number;
  endDate?: string;
  skippedPeriods: string[];
}

/**
 * Periods (YYYY-MM) whose billing date has arrived in Asia/Colombo and that have no invoice yet.
 * A missed day is caught up on the next run. Limited to the latest `maxCatchUp` periods.
 */
export function duePeriods(plan: PlanScheduleInput, today: string, invoiced: Set<string>, maxCatchUp = 12): string[] {
  if (plan.status !== "active") return [];
  if (plan.billingDay < 1 || plan.billingDay > 28) throw new Error("Billing day must be between 1 and 28");
  const out: string[] = [];
  const last = periodOf(today);
  for (let p = periodOf(plan.startDate); p <= last; p = nextPeriod(p)) {
    const bd = billingDate(p, plan.billingDay);
    if (bd < plan.startDate || bd > today) continue;
    if (plan.endDate && bd > plan.endDate) break;
    if (plan.skippedPeriods.includes(p) || invoiced.has(p)) continue;
    out.push(p);
  }
  return out.slice(-maxCatchUp);
}

/** The next billing date that will produce an invoice, or null if the plan has finished. */
export function nextBillingDate(plan: PlanScheduleInput, today: string, invoiced: Set<string>): string | null {
  if (plan.status === "ended") return null;
  // Anything already due but not invoiced will be created on the next run (today).
  if (duePeriods({ ...plan, status: "active" }, today, invoiced).length) return today;
  // Note: keep `p = nextPeriod(p)` out of the for-update clause. Turbopack's production build
  // mis-compiled `i++, p = nextPeriod(p)` (left `nextPeriod` unbound -> ReferenceError).
  let p = periodOf(plan.startDate < today ? today : plan.startDate);
  for (let i = 0; i < 36; i++) {
    if (i > 0) p = nextPeriod(p);
    const bd = billingDate(p, plan.billingDay);
    if (bd <= today || bd < plan.startDate) continue;
    if (plan.endDate && bd > plan.endDate) return null;
    if (plan.skippedPeriods.includes(p) || invoiced.has(p)) continue;
    return bd;
  }
  return null;
}

/**
 * Which reminder step to send today. Offsets are days relative to the due date
 * (-3 = three days before, 0 = due date, 7 = seven days overdue). Only the latest step that
 * has been reached is sent, and each step only once.
 */
export function pickReminderStep(offsets: number[], dueDate: string, today: string, sentSteps: number[]): number | null {
  const days = diffDays(dueDate, today);
  const reached = [...offsets].sort((a, b) => a - b).filter((o) => o <= days);
  if (reached.length === 0) return null;
  const latest = reached[reached.length - 1];
  return sentSteps.includes(latest) ? null : latest;
}

/** After the last reminder step has passed, the invoice is flagged for personal follow-up. */
export function needsFollowUp(offsets: number[], dueDate: string, today: string): boolean {
  if (offsets.length === 0) return false;
  return diffDays(dueDate, today) > Math.max(...offsets);
}

export function reminderTemplate(step: number): "reminder_before" | "reminder_due" | "reminder_overdue" {
  return step < 0 ? "reminder_before" : step === 0 ? "reminder_due" : "reminder_overdue";
}

export function parseOffsets(input: string): number[] {
  const nums = input.split(/[\s,]+/).filter(Boolean).map((s) => {
    const n = Number(s);
    if (!Number.isInteger(n) || n < -60 || n > 365) throw new Error(`"${s}" is not a valid number of days`);
    return n;
  });
  return [...new Set(nums)].sort((a, b) => a - b);
}
