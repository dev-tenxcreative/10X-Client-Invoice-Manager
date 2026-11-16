import { today } from "../dates";
import { retryPendingEmails } from "../email";
import { runRecurringPlans } from "./plans";
import { runOverdueDigest, runReminders } from "./reminders";
import { expireProposals } from "./proposals";
import { audit } from "./audit";

/**
 * The single daily job (Cron Trigger 02:30 UTC = 08:00 Asia/Colombo). Every step is idempotent,
 * so running it twice on the same day creates nothing twice.
 */
export async function runDailyJob(t = today()) {
  const started = Date.now();
  const result: Record<string, unknown> = { date: t };
  const step = async (name: string, fn: () => Promise<unknown>) => {
    try {
      result[name] = await fn();
    } catch (e) {
      console.error(`[job] step ${name} failed`, e);
      result[name] = { error: e instanceof Error ? e.message : String(e) };
    }
  };
  await step("plans", () => runRecurringPlans(t));
  await step("proposals", () => expireProposals(t));
  await step("reminders", () => runReminders(t));
  await step("digest", () => runOverdueDigest(t));
  await step("emailRetries", () => retryPendingEmails());
  result.ms = Date.now() - started;
  await audit(null, "job.daily", "job", t, undefined, result).catch(() => {});
  return result;
}
