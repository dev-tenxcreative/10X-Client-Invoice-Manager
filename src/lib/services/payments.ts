import { ObjectId, type ClientSession } from "mongodb";
import { cols, withTransaction } from "../db";
import { appUrl } from "../env";
import { AppError, ForbiddenError, NotFoundError } from "../errors";
import { formatMoney } from "../money";
import { formatDate, isDateString, today } from "../dates";
import { statusAfterPayment } from "../invoice-status";
import { adminEmails, sendEmail } from "../email";
import { storeFile } from "../storage";
import { audit, type Actor } from "./audit";
import { companyRecipients } from "./companies";
import { ensureInvoicePdf } from "./invoices";
import type { InvoiceDoc, PaymentDoc, PaymentMethod } from "../types";

/*
 * Payment logic lives here so an online gateway can later call recordPayment() the same way.
 * Balance = total - confirmed payments. Overpayment is blocked.
 */

export const METHOD_LABEL: Record<PaymentMethod, string> = {
  bank_transfer: "Bank transfer",
  cash: "Cash",
  cheque: "Cheque",
  online: "Online",
  other: "Other",
};

/** Recomputes paidTotal/balance/status from the payments collection inside the transaction. */
async function applyPayments(invoiceId: ObjectId, session: ClientSession): Promise<InvoiceDoc> {
  const c = await cols();
  const inv = await c.invoices.findOne({ _id: invoiceId }, { session });
  if (!inv) throw new NotFoundError("Invoice not found.");
  const payments = await c.payments.find({ invoiceId }, { session }).toArray();
  const paidTotal = payments.reduce((s, p) => s + p.amount, 0);
  if (paidTotal > inv.total) throw new AppError(`This payment is more than the balance of ${formatMoney(inv.balance, inv.currency)}.`, "amount");
  const status = statusAfterPayment(inv, paidTotal);
  const lastPaymentDate = payments.map((p) => p.date).sort().at(-1);
  const set: Partial<InvoiceDoc> = { paidTotal, balance: inv.total - paidTotal, status, lastPaymentDate, updatedAt: new Date() };
  if (status === "paid") set.paidAt = new Date();
  await c.invoices.updateOne({ _id: invoiceId }, { $set: set }, { session });
  return { ...inv, ...set } as InvoiceDoc;
}

export interface PaymentInput {
  invoiceId: ObjectId;
  date: string;
  amount: number;
  method: PaymentMethod;
  reference?: string;
  note?: string;
  receipt?: { bytes: Uint8Array; name: string };
}

async function notifyPayment(inv: InvoiceDoc, amount: number) {
  const c = await cols();
  const company = await c.companies.findOne({ _id: inv.companyId });
  const r = await companyRecipients(inv.companyId);
  if (!company || r.to.length === 0) return;
  const vars = {
    client_name: r.primaryName,
    company_name: company.name,
    invoice_number: inv.number,
    amount_paid: formatMoney(inv.status === "paid" ? inv.paidTotal : amount, inv.currency),
    amount_due: formatMoney(inv.balance, inv.currency),
    due_date: formatDate(inv.dueDate),
    action_link: appUrl(`/portal/invoices/${inv._id}`),
  };
  if (inv.status === "paid") {
    const pdf = await ensureInvoicePdf(inv).catch((e) => {
      console.error("[payments] receipt PDF failed", e);
      return null;
    });
    await sendEmail({ template: "payment_receipt", to: r.to, cc: r.cc, vars, attachments: pdf ? [pdf] : [], related: { type: "invoice", id: inv._id } });
  } else {
    await sendEmail({ template: "payment_recorded", to: r.to, cc: r.cc, vars: { ...vars, amount_paid: formatMoney(amount, inv.currency) }, related: { type: "invoice", id: inv._id } });
  }
}

export async function recordPayment(actor: Actor, input: PaymentInput, opts: { notify?: boolean; submissionId?: ObjectId } = {}) {
  if (!isDateString(input.date)) throw new AppError("Please enter a valid payment date.", "date");
  if (input.date > today()) throw new AppError("The payment date cannot be in the future.", "date");
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new AppError("Please enter an amount above zero.", "amount");
  const c = await cols();
  const pre = await c.invoices.findOne({ _id: input.invoiceId });
  if (!pre) throw new NotFoundError("Invoice not found.");
  if (pre.status === "draft") throw new AppError("Send the invoice before recording payments.");
  if (pre.status === "void") throw new AppError("This invoice is void.");
  if (input.amount > pre.balance) throw new AppError(`This is more than the balance of ${formatMoney(pre.balance, pre.currency)}.`, "amount");

  const receipt = input.receipt
    ? await storeFile({ bytes: input.receipt.bytes, originalName: input.receipt.name, kind: "receipt", companyId: pre.companyId, relatedId: pre._id, uploadedBy: actor.userId })
    : null;

  const { invoice, payment } = await withTransaction(async (session) => {
    const payment: PaymentDoc = {
      _id: new ObjectId(),
      invoiceId: pre._id,
      companyId: pre.companyId,
      date: input.date,
      amount: input.amount,
      currency: pre.currency,
      method: input.method,
      reference: input.reference?.trim() || undefined,
      note: input.note?.trim() || undefined,
      fileId: receipt?._id,
      submissionId: opts.submissionId,
      createdBy: actor.userId,
      createdAt: new Date(),
    };
    await c.payments.insertOne(payment, { session });
    const invoice = await applyPayments(pre._id, session);
    await audit(actor, "payment.record", "invoice", pre._id, { paidTotal: pre.paidTotal, status: pre.status }, { amount: payment.amount, paidTotal: invoice.paidTotal, status: invoice.status }, session);
    return { invoice, payment };
  });

  if (opts.notify !== false) await notifyPayment(invoice, payment.amount).catch((e) => console.error("[payments] notify failed", e));
  return { invoice, payment };
}

/** Client uploads a bank slip; an admin confirms or rejects it. */
export async function submitSlip(
  actor: Actor,
  scopeCompanyIds: ObjectId[],
  input: { invoiceId: ObjectId; amount: number; date: string; reference?: string; file: { bytes: Uint8Array; name: string } },
) {
  const c = await cols();
  const inv = await c.invoices.findOne({ _id: input.invoiceId });
  if (!inv || !scopeCompanyIds.some((id) => id.equals(inv.companyId)) || inv.status === "draft") throw new ForbiddenError();
  if (inv.status === "void" || inv.status === "paid") throw new AppError("This invoice does not need a payment.");
  if (!isDateString(input.date) || input.date > today()) throw new AppError("Please enter the date you paid.", "date");
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new AppError("Please enter the amount you paid.", "amount");
  if (input.amount > inv.balance) throw new AppError(`The amount is more than the balance of ${formatMoney(inv.balance, inv.currency)}.`, "amount");
  const file = await storeFile({ bytes: input.file.bytes, originalName: input.file.name, kind: "slip", companyId: inv.companyId, relatedId: inv._id, uploadedBy: actor.userId });
  const sub = {
    _id: new ObjectId(),
    invoiceId: inv._id,
    companyId: inv.companyId,
    userId: actor.userId,
    amount: input.amount,
    currency: inv.currency,
    date: input.date,
    reference: input.reference?.trim() || undefined,
    fileId: file._id,
    status: "pending" as const,
    createdAt: new Date(),
  };
  await c.paymentSubmissions.insertOne(sub);
  await audit(actor, "payment.slip_submit", "invoice", inv._id, undefined, { amount: sub.amount });
  const company = await c.companies.findOne({ _id: inv.companyId });
  const vars = {
    client_name: actor.name,
    company_name: company?.name ?? "",
    invoice_number: inv.number,
    amount_paid: formatMoney(sub.amount, inv.currency),
  };
  const admins = await adminEmails();
  if (admins.length) await sendEmail({ template: "slip_submitted_admin", to: admins, vars: { ...vars, action_link: appUrl(`/admin/payments?tab=slips`) }, related: { type: "invoice", id: inv._id } }).catch(() => {});
  await sendEmail({ template: "slip_received_client", to: [actor.email], vars: { ...vars, action_link: appUrl(`/portal/invoices/${inv._id}`) }, related: { type: "invoice", id: inv._id } }).catch(() => {});
  return sub;
}

export async function confirmSlip(actor: Actor, submissionId: ObjectId, override?: { amount?: number; date?: string; method?: PaymentMethod }) {
  const c = await cols();
  const sub = await c.paymentSubmissions.findOne({ _id: submissionId });
  if (!sub) throw new NotFoundError();
  if (sub.status !== "pending") throw new AppError("This slip has already been reviewed.");
  const claimed = await c.paymentSubmissions.updateOne({ _id: sub._id, status: "pending" }, { $set: { status: "confirmed", reviewedBy: actor.userId, reviewedAt: new Date() } });
  if (claimed.modifiedCount !== 1) throw new AppError("This slip has already been reviewed.");
  try {
    const { invoice, payment } = await recordPayment(
      actor,
      { invoiceId: sub.invoiceId, date: override?.date ?? sub.date, amount: override?.amount ?? sub.amount, method: override?.method ?? "bank_transfer", reference: sub.reference, note: "Confirmed from client payment slip" },
      { notify: false, submissionId: sub._id },
    );
    await c.payments.updateOne({ _id: payment._id }, { $set: { fileId: sub.fileId } });
    await c.paymentSubmissions.updateOne({ _id: sub._id }, { $set: { paymentId: payment._id } });
    const user = await c.users.findOne({ _id: sub.userId });
    const company = await c.companies.findOne({ _id: sub.companyId });
    if (user) {
      await sendEmail({
        template: "slip_confirmed",
        to: [user.email],
        vars: { client_name: user.name, company_name: company?.name, invoice_number: invoice.number, amount_paid: formatMoney(payment.amount, invoice.currency), amount_due: formatMoney(invoice.balance, invoice.currency), action_link: appUrl(`/portal/invoices/${invoice._id}`) },
        related: { type: "invoice", id: invoice._id },
      }).catch(() => {});
    }
    if (invoice.status === "paid") await notifyPayment(invoice, payment.amount).catch(() => {});
    return invoice;
  } catch (e) {
    await c.paymentSubmissions.updateOne({ _id: sub._id }, { $set: { status: "pending" }, $unset: { reviewedBy: "", reviewedAt: "" } });
    throw e;
  }
}

export async function rejectSlip(actor: Actor, submissionId: ObjectId, reason: string) {
  if (!reason.trim()) throw new AppError("Please give a reason so the client knows what to fix.", "reason");
  const c = await cols();
  const sub = await c.paymentSubmissions.findOne({ _id: submissionId });
  if (!sub) throw new NotFoundError();
  const res = await c.paymentSubmissions.updateOne(
    { _id: sub._id, status: "pending" },
    { $set: { status: "rejected", rejectReason: reason.trim(), reviewedBy: actor.userId, reviewedAt: new Date() } },
  );
  if (res.modifiedCount !== 1) throw new AppError("This slip has already been reviewed.");
  await audit(actor, "payment.slip_reject", "invoice", sub.invoiceId, undefined, { reason });
  const user = await c.users.findOne({ _id: sub.userId });
  const inv = await c.invoices.findOne({ _id: sub.invoiceId });
  if (user && inv) {
    await sendEmail({
      template: "slip_rejected",
      to: [user.email],
      vars: { client_name: user.name, invoice_number: inv.number, reason: reason.trim(), action_link: appUrl(`/portal/invoices/${inv._id}`) },
      related: { type: "invoice", id: inv._id },
    }).catch(() => {});
  }
}

export async function invoicePayments(invoiceId: ObjectId) {
  const c = await cols();
  const [payments, submissions] = await Promise.all([
    c.payments.find({ invoiceId }).sort({ date: 1, createdAt: 1 }).toArray(),
    c.paymentSubmissions.find({ invoiceId }).sort({ createdAt: -1 }).toArray(),
  ]);
  return { payments, submissions };
}
