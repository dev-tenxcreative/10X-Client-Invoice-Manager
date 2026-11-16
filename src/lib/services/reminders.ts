import { MongoServerError, ObjectId } from "mongodb";
import { cols } from "../db";
import { appUrl } from "../env";
import { colomboDate, diffDays, formatDate, today, weekday } from "../dates";
import { formatMoney } from "../money";
import { OPEN_STATUSES } from "../invoice-status";
import { needsFollowUp, pickReminderStep, reminderTemplate } from "../schedule";
import { adminEmails, sendEmail } from "../email";
import { getSettings } from "./settings";
import { companyRecipients } from "./companies";

/**
 * Sends at most one reminder per invoice per run: the latest step reached, if not sent before.
 * reminderLogs has a unique index on {invoiceId, step}, so a step is sent once even if the job
 * runs twice. Draft, Paid and Void invoices never get reminders.
 */
export async function runReminders(t = today()) {
  const c = await cols();
  const settings = await getSettings();
  const invoices = await c.invoices.find({ status: { $in: OPEN_STATUSES }, balance: { $gt: 0 }, remindersEnabled: true }).toArray();
  const companies = new Map((await c.companies.find({ _id: { $in: [...new Set(invoices.map((i) => i.companyId.toHexString()))].map((h) => new ObjectId(h)) } }).toArray()).map((co) => [co._id.toHexString(), co]));
  let sent = 0;
  let flagged = 0;
  const errors: string[] = [];

  for (const inv of invoices) {
    try {
      const company = companies.get(inv.companyId.toHexString());
      if (!company) continue;
      const offsets = company.reminderOffsets ?? settings.reminderOffsets;
      // Do not remind on the same day the invoice was sent.
      if (inv.sentAt && colomboDate(inv.sentAt) === t) continue;

      if (needsFollowUp(offsets, inv.dueDate, t) && !inv.followUp) {
        await c.invoices.updateOne({ _id: inv._id }, { $set: { followUp: true } });
        flagged++;
        const admins = await adminEmails();
        if (admins.length) {
          await sendEmail({
            template: "follow_up_admin",
            to: admins,
            vars: { invoice_number: inv.number, company_name: company.name, amount_due: formatMoney(inv.balance, inv.currency), due_date: formatDate(inv.dueDate), action_link: appUrl(`/admin/invoices/${inv._id}`) },
            related: { type: "invoice", id: inv._id },
          });
        }
      }

      const sentSteps = (await c.reminderLogs.find({ invoiceId: inv._id }).toArray()).map((r) => r.step);
      const step = pickReminderStep(offsets, inv.dueDate, t, sentSteps);
      if (step === null) continue;
      try {
        await c.reminderLogs.insertOne({ _id: new ObjectId(), invoiceId: inv._id, step, sentAt: new Date() });
      } catch (e) {
        if (e instanceof MongoServerError && e.code === 11000) continue; // already sent by a parallel run
        throw e;
      }
      const r = await companyRecipients(inv.companyId);
      if (r.to.length === 0) continue;
      const log = await sendEmail({
        template: reminderTemplate(step),
        to: r.to,
        cc: r.cc,
        vars: {
          client_name: r.primaryName,
          company_name: company.name,
          invoice_number: inv.number,
          amount_due: formatMoney(inv.balance, inv.currency),
          due_date: formatDate(inv.dueDate),
          days_overdue: Math.max(0, diffDays(inv.dueDate, t)),
          portal_link: appUrl(`/portal/invoices/${inv._id}`),
          action_link: appUrl(`/portal/invoices/${inv._id}`),
        },
        related: { type: "invoice", id: inv._id },
      });
      await c.reminderLogs.updateOne({ invoiceId: inv._id, step }, { $set: { emailLogId: log._id } });
      sent++;
    } catch (e) {
      console.error(`[job] reminder for ${inv.number} failed`, e);
      errors.push(`${inv.number}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { checked: invoices.length, sent, flagged, errors };
}

/** Every Monday (Colombo), one digest of overdue invoices to admins. */
export async function runOverdueDigest(t = today()) {
  if (weekday(t) !== 1) return { sent: false };
  const c = await cols();
  try {
    await c.jobRuns.insertOne({ _id: `digest-${t}`, at: new Date() });
  } catch (e) {
    if (e instanceof MongoServerError && e.code === 11000) return { sent: false };
    throw e;
  }
  const overdue = await c.invoices.find({ status: { $in: OPEN_STATUSES }, balance: { $gt: 0 }, dueDate: { $lt: t } }).sort({ dueDate: 1 }).toArray();
  if (overdue.length === 0) return { sent: false };
  const companies = new Map((await c.companies.find({ _id: { $in: overdue.map((i) => i.companyId) } }).toArray()).map((co) => [co._id.toHexString(), co.name]));
  const list = overdue
    .map((i) => `• ${i.number}, ${companies.get(i.companyId.toHexString()) ?? ""}: ${formatMoney(i.balance, i.currency)}, due ${formatDate(i.dueDate)} (${diffDays(i.dueDate, t)} days overdue)`)
    .join("\n");
  const admins = await adminEmails();
  if (admins.length) {
    await sendEmail({
      template: "overdue_digest_admin",
      to: admins,
      vars: { count: overdue.length, today: formatDate(t), list, action_link: appUrl("/admin/invoices?tab=overdue") },
    });
  }
  return { sent: true, count: overdue.length };
}
