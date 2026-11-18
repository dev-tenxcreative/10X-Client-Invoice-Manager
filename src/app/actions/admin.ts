"use server";

import { z } from "zod";
import { ObjectId } from "mongodb";
import { requireAdmin, requireSuperAdmin } from "@/lib/auth/session";
import { AppError, toActionError, type ActionResult } from "@/lib/errors";
import {
  fileFrom, formObject, moneyField, oid, parseDiscount, parseEmails, parseItems, parseTax, parseWith,
  zBool, zCurrency, zDate, zEmail, zId, zInt, zOptDate, zOptText, zText,
} from "@/lib/forms";
import { validateUpload, UploadError, storeFile } from "@/lib/storage";
import { formatMoney, parseRateBp } from "@/lib/money";
import { parseOffsets } from "@/lib/schedule";
import type { Actor } from "@/lib/services/audit";
import { audit } from "@/lib/services/audit";
import * as companies from "@/lib/services/companies";
import * as users from "@/lib/services/users";
import * as invoices from "@/lib/services/invoices";
import * as payments from "@/lib/services/payments";
import * as plans from "@/lib/services/plans";
import * as proposals from "@/lib/services/proposals";
import { getSettings, updateSettings } from "@/lib/services/settings";
import { resendLogged, sendEmail } from "@/lib/email";
import { appUrl } from "@/lib/env";
import { cols } from "@/lib/db";
import type { Currency, PaymentMethod, ProposalContent } from "@/lib/types";

async function run<T>(name: string, fn: (actor: Actor) => Promise<ActionResult<T>>, superOnly = false): Promise<ActionResult<T>> {
  try {
    const auth = superOnly ? await requireSuperAdmin() : await requireAdmin();
    return await fn(auth.actor);
  } catch (e) {
    if (e instanceof UploadError) return { ok: false, error: e.message, fieldErrors: { file: e.message } };
    return toActionError(e, name);
  }
}

async function upload(fd: FormData, name: string, opts: { pdfOnly?: boolean; required?: boolean } = {}) {
  const f = fileFrom(fd, name);
  if (!f) {
    if (opts.required) throw new AppError("Please choose a file.", name);
    return undefined;
  }
  try {
    return { bytes: await validateUpload(f, opts), name: f.name };
  } catch (e) {
    if (e instanceof UploadError) throw new AppError(e.message, name);
    throw e;
  }
}

// ---------------- Clients & companies ----------------

const companySchema = z.object({
  "company.name": zText("the company name"),
  "company.billingAddress": zText("the billing address", 300),
  "company.city": zText("the city", 100),
  "company.country": zText("the country", 100),
  "company.taxNumber": zOptText(60),
  "company.currency": zCurrency,
  "company.paymentTermsDays": zInt("Payment terms", 0, 120),
  "company.notes": zOptText(2000),
});

function companyFrom(d: Record<string, string>) {
  const p = parseWith(companySchema, d);
  return {
    name: p["company.name"],
    billingAddress: p["company.billingAddress"],
    city: p["company.city"],
    country: p["company.country"],
    taxNumber: p["company.taxNumber"],
    currency: p["company.currency"] as Currency,
    paymentTermsDays: p["company.paymentTermsDays"],
    notes: p["company.notes"],
    billingEmails: parseEmails(d["company.billingEmails"], "company.billingEmails"),
  };
}

const contactSchema = z.object({
  "contact.name": zText("the contact's full name", 120),
  "contact.email": zEmail,
  "contact.phone": zOptText(40),
  "contact.designation": zOptText(80),
});

export async function createClientAction(fd: FormData): Promise<ActionResult> {
  return run("createClient", async (actor) => {
    const d = formObject(fd);
    const contact = parseWith(contactSchema, d);
    const existing = d.mode === "existing";
    const res = await companies.createClient(actor, {
      contact: { name: contact["contact.name"], email: contact["contact.email"], phone: contact["contact.phone"], designation: contact["contact.designation"] },
      company: existing ? undefined : companyFrom(d),
      existingCompanyId: existing ? parseWith(z.object({ existingCompanyId: zId }), d).existingCompanyId : undefined,
      sendInvite: d.sendInvite === "on",
    });
    return { ok: true, message: res.invited ? `Client saved. Invitation sent to ${res.user.email}.` : "Client saved.", redirect: `/admin/companies/${res.company._id}` };
  });
}

export async function checkDuplicatesAction(email: string, companyName: string) {
  await requireAdmin();
  return companies.checkDuplicates({ email: email || undefined, companyName: companyName || undefined });
}

export async function updateCompanyAction(fd: FormData): Promise<ActionResult> {
  return run("updateCompany", async (actor) => {
    const d = formObject(fd);
    const id = oid(d.id);
    let reminderOffsets: number[] | null = null;
    if (d.reminderOffsets?.trim()) {
      try { reminderOffsets = parseOffsets(d.reminderOffsets); } catch (e) { throw new AppError((e as Error).message, "reminderOffsets"); }
    }
    await companies.updateCompany(actor, id, { ...companyFrom(d), reminderOffsets });
    return { ok: true, message: "Company details saved." };
  });
}

export async function addContactAction(fd: FormData): Promise<ActionResult> {
  return run("addContact", async (actor) => {
    const d = formObject(fd);
    const c = parseWith(contactSchema, d);
    const res = await companies.addContact(actor, oid(d.companyId), { name: c["contact.name"], email: c["contact.email"], phone: c["contact.phone"], designation: c["contact.designation"] }, d.sendInvite === "on");
    return { ok: true, message: res.linked ? "Existing contact linked to this company." : "Contact added." };
  });
}

export async function unlinkContactAction(fd: FormData): Promise<ActionResult> {
  return run("unlinkContact", async (actor) => {
    await companies.unlinkContact(actor, oid(String(fd.get("companyId"))), oid(String(fd.get("userId"))));
    return { ok: true, message: "Contact removed from this company." };
  });
}

export async function archiveCompanyAction(fd: FormData): Promise<ActionResult> {
  return run("archiveCompany", async (actor) => {
    const archive = fd.get("archive") === "1";
    await companies.setCompanyArchived(actor, oid(String(fd.get("id"))), archive);
    return { ok: true, message: archive ? "Company archived. Its active plans were paused." : "Company restored." };
  });
}

export async function userInviteAction(fd: FormData): Promise<ActionResult> {
  return run("userInvite", async (actor) => {
    const id = oid(String(fd.get("userId")));
    const op = String(fd.get("op"));
    if (op === "resend") await users.resendInvitation(actor, id);
    else if (op === "cancel") await users.cancelInvitation(actor, id);
    else if (op === "deactivate") await users.setUserStatus(actor, id, "deactivated");
    else if (op === "reactivate") await users.setUserStatus(actor, id, "active");
    else throw new AppError("Unknown action.");
    const msg: Record<string, string> = { resend: "Invitation sent again.", cancel: "Invitation cancelled.", deactivate: "User deactivated and signed out.", reactivate: "User reactivated." };
    return { ok: true, message: msg[op] };
  });
}

// ---------------- Admins (super admin only) ----------------

export async function inviteAdminAction(fd: FormData): Promise<ActionResult> {
  return run("inviteAdmin", async (actor) => {
    const d = parseWith(z.object({ name: zText("the name", 120), email: zEmail }), formObject(fd));
    const u = await users.inviteAdmin(actor, d);
    return { ok: true, message: `Invitation sent to ${u.email}.` };
  }, true);
}

export async function adminUserAction(fd: FormData): Promise<ActionResult> {
  return run("adminUser", async (actor) => {
    const id = oid(String(fd.get("userId")));
    const op = String(fd.get("op"));
    if (op === "restore") {
      const u = await users.restoreAdmin(actor, id);
      return { ok: true, message: `Admin access restored. A new activation link was sent to ${u.email}.` };
    }
    if (op === "remove") {
      await users.removeAdmin(actor, id);
      return { ok: true, message: "Admin deleted." };
    }
    if (op === "deactivate") await users.setUserStatus(actor, id, "deactivated");
    else if (op === "reactivate") await users.setUserStatus(actor, id, "active");
    else if (op === "resend") await users.resendInvitation(actor, id);
    else if (op === "cancel") await users.cancelInvitation(actor, id);
    else throw new AppError("Unknown action.");
    return { ok: true, message: "Done." };
  }, true);
}

// ---------------- Invoices ----------------

function invoiceInput(d: Record<string, string>) {
  const base = parseWith(z.object({
    companyId: zId,
    issueDate: zDate("the issue date"),
    dueDate: zDate("the due date"),
    currency: zCurrency,
    notes: zOptText(2000),
    paymentInstructions: zOptText(2000),
    billingPeriod: zOptText(60),
  }), d);
  const currency = base.currency as Currency;
  return {
    ...base,
    currency,
    items: parseItems(d.items, currency),
    discount: parseDiscount(d.discountType, d.discountValue, currency),
    tax: parseTax(d.taxLabel, d.taxRate),
    remindersEnabled: d.remindersEnabled === "on",
  };
}

export async function createInvoiceAction(fd: FormData): Promise<ActionResult> {
  return run("createInvoice", async (actor) => {
    const inv = await invoices.createGeneratedInvoice(actor, invoiceInput(formObject(fd)));
    if (fd.get("intent") === "send") {
      await invoices.sendInvoice(actor, inv._id);
      return { ok: true, message: `Invoice ${inv.number} created and sent.`, redirect: `/admin/invoices/${inv._id}` };
    }
    return { ok: true, message: `Draft ${inv.number} saved.`, redirect: `/admin/invoices/${inv._id}` };
  });
}

export async function updateInvoiceAction(fd: FormData): Promise<ActionResult> {
  return run("updateInvoice", async (actor) => {
    const d = formObject(fd);
    const id = oid(d.id);
    await invoices.updateDraftInvoice(actor, id, invoiceInput(d));
    if (d.intent === "send") {
      await invoices.sendInvoice(actor, id);
      return { ok: true, message: "Invoice saved and sent.", redirect: `/admin/invoices/${id}` };
    }
    return { ok: true, message: "Draft saved.", redirect: `/admin/invoices/${id}` };
  });
}

export async function uploadInvoiceAction(fd: FormData): Promise<ActionResult> {
  return run("uploadInvoice", async (actor) => {
    const d = formObject(fd);
    const p = parseWith(z.object({ companyId: zId, number: zText("the invoice number", 60), issueDate: zDate("the issue date"), dueDate: zDate("the due date"), currency: zCurrency, description: zOptText(500) }), d);
    const total = moneyField(d.total, p.currency, "total");
    const file = await upload(fd, "file", { pdfOnly: true, required: true });
    const inv = await invoices.createUploadedInvoice(actor, { ...p, currency: p.currency as Currency, total, remindersEnabled: d.remindersEnabled === "on", markSent: d.markSent === "on" }, file!);
    return { ok: true, message: `Invoice ${inv.number} uploaded.`, redirect: `/admin/invoices/${inv._id}` };
  });
}

export async function sendInvoiceAction(fd: FormData): Promise<ActionResult> {
  return run("sendInvoice", async (actor) => {
    const log = await invoices.sendInvoice(actor, oid(String(fd.get("id"))), { email: fd.get("email") !== "0" });
    if (log && log.status === "failed") return { ok: true, message: `The invoice is marked as sent, but the email failed: ${log.error ?? "unknown error"}. You can resend it from the email log.` };
    return { ok: true, message: log ? `Invoice emailed to ${log.to.join(", ")}.` : "Invoice marked as sent." };
  });
}

export async function voidInvoiceAction(fd: FormData): Promise<ActionResult> {
  return run("voidInvoice", async (actor) => {
    await invoices.voidInvoice(actor, oid(String(fd.get("id"))), String(fd.get("reason") ?? ""));
    return { ok: true, message: "Invoice voided." };
  });
}

export async function discardDraftAction(fd: FormData): Promise<ActionResult> {
  return run("discardDraft", async (actor) => {
    await invoices.deleteDraftInvoice(actor, oid(String(fd.get("id"))));
    return { ok: true, message: "Draft discarded. Its number will not be reused.", redirect: "/admin/invoices" };
  });
}

export async function duplicateInvoiceAction(fd: FormData): Promise<ActionResult> {
  return run("duplicateInvoice", async (actor) => {
    const inv = await invoices.duplicateAsDraft(actor, oid(String(fd.get("id"))));
    return { ok: true, message: `New draft ${inv.number} created.`, redirect: `/admin/invoices/${inv._id}/edit` };
  });
}

export async function invoiceRemindersAction(fd: FormData): Promise<ActionResult> {
  return run("invoiceReminders", async (actor) => {
    const id = oid(String(fd.get("id")));
    if (fd.get("op") === "clearFollowUp") await invoices.clearFollowUp(actor, id);
    else await invoices.setRemindersEnabled(actor, id, fd.get("enabled") === "1");
    return { ok: true, message: "Saved." };
  });
}

// ---------------- Payments ----------------

export async function recordPaymentAction(fd: FormData): Promise<ActionResult> {
  return run("recordPayment", async (actor) => {
    const d = formObject(fd);
    const inv = await invoices.getInvoice(oid(d.invoiceId));
    if (!inv) throw new AppError("Invoice not found.");
    const p = parseWith(z.object({ date: zDate("the payment date"), method: z.enum(["bank_transfer", "cash", "cheque", "online", "other"]), reference: zOptText(120), note: zOptText(500) }), d);
    const amount = moneyField(d.amount, inv.currency, "amount");
    const receipt = await upload(fd, "file");
    const res = await payments.recordPayment(actor, { invoiceId: inv._id, amount, date: p.date, method: p.method as PaymentMethod, reference: p.reference, note: p.note, receipt });
    return { ok: true, message: res.invoice.status === "paid" ? "Payment recorded. The invoice is now paid and a receipt was emailed." : `Payment of ${formatMoney(amount, inv.currency)} recorded.` };
  });
}

export async function reviewSlipAction(fd: FormData): Promise<ActionResult> {
  return run("reviewSlip", async (actor) => {
    const id = oid(String(fd.get("id")));
    if (fd.get("op") === "confirm") {
      await payments.confirmSlip(actor, id);
      return { ok: true, message: "Payment confirmed and the client was notified." };
    }
    await payments.rejectSlip(actor, id, String(fd.get("reason") ?? ""));
    return { ok: true, message: "Slip rejected and the client was told why." };
  });
}

// ---------------- Recurring plans ----------------

function planInput(d: Record<string, string>) {
  const p = parseWith(z.object({
    companyId: zId,
    name: zText("the plan name", 120),
    currency: zCurrency,
    startDate: zDate("the start date"),
    endDate: zOptDate,
    billingDay: zInt("Billing day", 1, 28),
    dueAfterDays: zInt("Due after", 0, 120),
    mode: z.enum(["auto", "review"]),
    notes: zOptText(2000),
  }), d);
  const currency = p.currency as Currency;
  return { ...p, currency, items: parseItems(d.items, currency), discount: parseDiscount(d.discountType, d.discountValue, currency), tax: parseTax(d.taxLabel, d.taxRate) };
}

export async function createPlanAction(fd: FormData): Promise<ActionResult> {
  return run("createPlan", async (actor) => {
    const plan = await plans.createPlan(actor, planInput(formObject(fd)));
    return { ok: true, message: "Recurring plan created.", redirect: `/admin/plans/${plan._id}` };
  });
}

export async function updatePlanAction(fd: FormData): Promise<ActionResult> {
  return run("updatePlan", async (actor) => {
    const d = formObject(fd);
    await plans.updatePlan(actor, oid(d.id), planInput(d));
    return { ok: true, message: "Plan saved. Changes apply to future invoices only." };
  });
}

export async function planOpAction(fd: FormData): Promise<ActionResult> {
  return run("planOp", async (actor) => {
    const id = oid(String(fd.get("id")));
    const op = String(fd.get("op"));
    if (op === "run") {
      const inv = await plans.runPlanNow(actor, id);
      return { ok: true, message: `Invoice ${inv.number} created${inv.status === "draft" ? " as a draft for review" : " and sent"}.` };
    }
    if (op === "skip" || op === "unskip") {
      await plans.skipPeriod(actor, id, String(fd.get("period")), op === "skip");
      return { ok: true, message: op === "skip" ? "Month skipped." : "Month restored." };
    }
    if (op === "active" || op === "paused" || op === "ended") {
      await plans.setPlanStatus(actor, id, op);
      return { ok: true, message: `Plan ${op === "active" ? "resumed" : op}.` };
    }
    throw new AppError("Unknown action.");
  });
}

// ---------------- Proposals ----------------

export async function createProposalAction(fd: FormData): Promise<ActionResult> {
  return run("createProposal", async (actor) => {
    const d = parseWith(z.object({ companyId: zId, template: z.enum(["web", "social", "seo", "blank"]), title: z.string().max(200).optional() }), formObject(fd));
    const p = await proposals.createBuiltProposal(actor, { companyId: d.companyId, template: d.template, title: d.title ?? "" });
    return { ok: true, message: `Proposal ${p.reference} started.`, redirect: `/admin/proposals/${p._id}/edit` };
  });
}

export async function uploadProposalAction(fd: FormData): Promise<ActionResult> {
  return run("uploadProposal", async (actor) => {
    const d = formObject(fd);
    const p = parseWith(z.object({ companyId: zId, title: zText("the title"), reference: z.string().max(40).optional().default(""), date: zDate("the date"), validUntil: zDate("the valid-until date"), currency: zCurrency }), d);
    const total = moneyField(d.total, p.currency, "total");
    const file = await upload(fd, "file", { pdfOnly: true, required: true });
    const doc = await proposals.createUploadedProposal(actor, { ...p, currency: p.currency as Currency, total }, file!);
    return { ok: true, message: `Proposal ${doc.reference} uploaded.`, redirect: `/admin/proposals/${doc._id}` };
  });
}

/** Autosave / save from the builder. Content is sent as JSON with money as decimal strings. */
export async function saveProposalAction(id: string, json: string, reference?: string): Promise<ActionResult<{ versioned: boolean }>> {
  return run("saveProposal", async (actor) => {
    const raw = JSON.parse(json) as Omit<ProposalContent, "investment" | "discount" | "tax" | "paymentSchedule"> & {
      investment: unknown; discountType: string; discountValue: string; taxLabel: string; taxRate: string;
      paymentSchedule: { label: string; type: "percent" | "amount"; value: string; dueNote?: string }[];
    };
    const currency = (raw.currency === "USD" ? "USD" : "LKR") as Currency;
    const content: ProposalContent = {
      title: String(raw.title ?? "").slice(0, 200),
      projectTitle: String(raw.projectTitle ?? "").slice(0, 200),
      date: raw.date,
      validUntil: raw.validUntil,
      currency,
      sections: (raw.sections ?? []).slice(0, 20).map((s) => ({ key: String(s.key), title: String(s.title).slice(0, 120), body: String(s.body ?? "").slice(0, 20000), hidden: Boolean(s.hidden) })),
      investment: parseItems(JSON.stringify(raw.investment ?? []), currency, { allowZeroPrice: true, allowEmpty: true }).map((i) => ({ ...i, amount: 0 })),
      investmentNotes: String(raw.investmentNotes ?? "").slice(0, 1000) || undefined,
      discount: parseDiscount(raw.discountType, raw.discountValue, currency),
      tax: parseTax(raw.taxLabel, raw.taxRate),
      timeline: (raw.timeline ?? []).slice(0, 50).filter((r) => r.phase?.trim()).map((r) => ({ phase: String(r.phase).slice(0, 200), duration: String(r.duration ?? "").slice(0, 80), notes: String(r.notes ?? "").slice(0, 300) || undefined })),
      paymentSchedule: (raw.paymentSchedule ?? []).slice(0, 20).filter((m) => m.label?.trim()).map((m) => {
        try {
          return { label: m.label.slice(0, 120), type: m.type === "amount" ? "amount" as const : "percent" as const, value: m.type === "amount" ? moneyField(m.value, currency, "paymentSchedule") : parseRateBp(m.value), dueNote: m.dueNote?.slice(0, 120) || undefined };
        } catch {
          throw new AppError(`Payment schedule: "${m.label}" needs a valid ${m.type === "amount" ? "amount" : "percentage"}.`, "paymentSchedule");
        }
      }),
    };
    const res = await proposals.saveProposalContent(actor, oid(id), content, reference);
    return { ok: true, data: res, message: res.versioned ? "Saved as a new version. Send it again when ready." : undefined };
  });
}

export async function sendProposalAction(fd: FormData): Promise<ActionResult> {
  return run("sendProposal", async (actor) => {
    const log = await proposals.sendProposal(actor, oid(String(fd.get("id"))), fd.get("attachPdf") === "on");
    if (log.status === "failed") return { ok: true, message: `Marked as sent, but the email failed: ${log.error}. Resend it from the email log.` };
    return { ok: true, message: `Proposal emailed to ${log.to.join(", ")}.` };
  });
}

export async function proposalAcceptManualAction(fd: FormData): Promise<ActionResult> {
  return run("proposalAcceptManual", async (actor) => {
    const d = formObject(fd);
    const file = await upload(fd, "file");
    await proposals.markAcceptedManually(actor, oid(d.id), { name: d.name ?? "", designation: d.designation ?? "", date: d.date ?? "" }, file);
    return { ok: true, message: "Proposal marked as accepted." };
  });
}

export async function proposalInvoicesAction(fd: FormData): Promise<ActionResult> {
  return run("proposalInvoices", async (actor) => {
    const created = await proposals.createInvoicesFromSchedule(actor, oid(String(fd.get("id"))));
    return { ok: true, message: `${created.length} draft invoice${created.length > 1 ? "s" : ""} created: ${created.map((c) => c.number).join(", ")}.`, redirect: "/admin/invoices?tab=draft" };
  });
}

export async function proposalPlanAction(fd: FormData): Promise<ActionResult> {
  return run("proposalPlan", async (actor) => {
    const d = parseWith(z.object({ id: z.string(), startDate: zDate("the start date"), billingDay: zInt("Billing day", 1, 28), dueAfterDays: zInt("Due after", 0, 120), mode: z.enum(["auto", "review"]) }), formObject(fd));
    const plan = await proposals.createPlanFromProposal(actor, oid(d.id), d);
    return { ok: true, message: "Recurring plan created from the proposal.", redirect: `/admin/plans/${plan._id}` };
  });
}

// ---------------- Settings ----------------

export async function saveSettingsAction(fd: FormData): Promise<ActionResult> {
  return run("saveSettings", async (actor) => {
    const d = formObject(fd);
    const section = d.section;
    const before = await getSettings();
    if (section === "company") {
      const p = parseWith(z.object({
        legalName: zText("the legal name"), brandName: zText("the brand name"), address: zText("the address", 300), phone: zText("the phone", 40),
        email: zEmail, website: zText("the website"), registrationNumber: z.string().max(60), taxNumber: z.string().max(60),
        signatoryName: zText("the signatory name"), signatoryTitle: zText("the signatory title"),
      }), d);
      await updateSettings(p);
    } else if (section === "bank") {
      const p = parseWith(z.object({ bankName: z.string().max(100), branch: z.string().max(100), accountName: z.string().max(120), accountNumber: z.string().max(60), swift: z.string().max(20) }), d);
      await updateSettings({ bank: p });
    } else if (section === "billing") {
      const p = parseWith(z.object({
        defaultCurrency: zCurrency, defaultPaymentTermsDays: zInt("Payment terms", 0, 120), taxLabel: zText("the tax label", 40),
        invoicePrefix: z.string().regex(/^[A-Za-z0-9-]{2,20}$/, "Use letters, numbers and dashes."), proposalPrefix: z.string().regex(/^[A-Za-z0-9-]{2,20}$/, "Use letters, numbers and dashes."),
        invoiceNotes: z.string().max(2000), invoiceThankYou: z.string().max(200), emailDailyLimit: zInt("Daily email limit", 1, 2000),
      }), d);
      let rateBp = 0;
      try { rateBp = parseRateBp(d.taxRate || "0"); } catch { throw new AppError("Tax rate must be between 0 and 100.", "taxRate"); }
      const currencies = (["LKR", "USD"] as Currency[]).filter((c) => d[`currency_${c}`] === "on" || c === p.defaultCurrency);
      await updateSettings({
        defaultCurrency: p.defaultCurrency as Currency, defaultPaymentTermsDays: p.defaultPaymentTermsDays, tax: { label: p.taxLabel, rateBp },
        numbering: { invoicePrefix: p.invoicePrefix, proposalPrefix: p.proposalPrefix }, invoiceNotes: p.invoiceNotes, invoiceThankYou: p.invoiceThankYou,
        emailDailyLimit: p.emailDailyLimit, currencies,
      });
    } else if (section === "reminders") {
      try { await updateSettings({ reminderOffsets: parseOffsets(d.reminderOffsets ?? "") }); } catch (e) { throw new AppError((e as Error).message, "reminderOffsets"); }
    } else if (section === "template") {
      const key = d.key;
      if (!before.emailTemplates[key]) throw new AppError("Unknown template.");
      const p = parseWith(z.object({ subject: zText("a subject", 200), body: zText("the message", 5000), buttonLabel: z.string().max(40) }), d);
      await updateSettings({ emailTemplates: { ...before.emailTemplates, [key]: { subject: p.subject, body: p.body, buttonLabel: p.buttonLabel || undefined } } });
    } else if (section === "logo") {
      const file = await upload(fd, "file", { required: true });
      const stored = await storeFile({ bytes: file!.bytes, originalName: file!.name, kind: "logo", uploadedBy: actor.userId });
      await updateSettings({ logoFileId: stored._id });
    } else throw new AppError("Unknown settings section.");
    await audit(actor, `settings.${section}`, "settings", "global", undefined, section === "template" ? { key: d.key } : undefined);
    return { ok: true, message: "Settings saved." };
  });
}

export async function testTemplateAction(fd: FormData): Promise<ActionResult> {
  return run("testTemplate", async (actor) => {
    const key = String(fd.get("key"));
    const log = await sendEmail({
      template: key,
      to: [actor.email],
      vars: {
        client_name: actor.name, company_name: "Sample Company (Pvt) Ltd", invoice_number: "10X-INV-2026-0001", amount_due: "LKR 65,000.00", amount_paid: "LKR 65,000.00",
        due_date: "30 Nov 2026", days_overdue: 7, portal_link: appUrl("/portal"), action_link: appUrl("/portal"), proposal_reference: "10X-PRO-2026-001",
        proposal_title: "Website redesign", proposal_total: "LKR 450,000.00", valid_until: "16 Dec 2026", reason: "Sample reason", plan_name: "Social media retainer",
        response: "accepted", details: "Sample details", count: 2, today: "16 Nov 2026", list: "• 10X-INV-2026-0001, Sample Company: LKR 65,000.00", unpaid_summary: "",
      },
    });
    return log.status === "sent" ? { ok: true, message: `Test sent to ${actor.email}.` } : { ok: false, error: `Sending failed: ${log.error ?? log.status}` };
  });
}

export async function saveTextBlockAction(fd: FormData): Promise<ActionResult> {
  return run("saveTextBlock", async (actor) => {
    const d = parseWith(z.object({ id: z.string().optional(), title: zText("a title", 120), category: z.string().max(60).default("General"), body: zText("the text", 20000) }), formObject(fd));
    const c = await cols();
    if (d.id && ObjectId.isValid(d.id)) await c.textBlocks.updateOne({ _id: new ObjectId(d.id) }, { $set: { title: d.title, category: d.category || "General", body: d.body, updatedAt: new Date() } });
    else await c.textBlocks.insertOne({ _id: new ObjectId(), title: d.title, category: d.category || "General", body: d.body, createdAt: new Date(), updatedAt: new Date() });
    await audit(actor, "settings.text_block", "textBlock", d.id);
    return { ok: true, message: "Text block saved." };
  });
}

export async function deleteTextBlockAction(fd: FormData): Promise<ActionResult> {
  return run("deleteTextBlock", async (actor) => {
    const c = await cols();
    await c.textBlocks.deleteOne({ _id: oid(String(fd.get("id"))) });
    await audit(actor, "settings.text_block_delete", "textBlock", String(fd.get("id")));
    return { ok: true, message: "Text block deleted." };
  });
}

// ---------------- Emails ----------------

export async function resendEmailAction(fd: FormData): Promise<ActionResult> {
  return run("resendEmail", async (actor) => {
    const status = await resendLogged(oid(String(fd.get("id"))));
    await audit(actor, "email.resend", "email", String(fd.get("id")));
    return status === "sent" ? { ok: true, message: "Email sent." } : { ok: false, error: status === "queued" ? "Daily limit reached. It will send tomorrow." : "Sending failed again. Check the error in the log." };
  });
}
