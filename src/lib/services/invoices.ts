import { ObjectId, type ClientSession, type Filter } from "mongodb";
import { cols, withTransaction } from "../db";
import { appUrl } from "../env";
import { AppError, ForbiddenError, NotFoundError } from "../errors";
import { computeTotals, formatMoney, formatQty, formatRate, normaliseItems } from "../money";
import { addDays, formatDate, isDateString, today } from "../dates";
import { displayStatus, isOverdue, OPEN_STATUSES } from "../invoice-status";
import { renderInvoiceHtml, forPrint, invoiceBadge } from "../documents/invoice-html";
import { renderPdf } from "../pdf/render";
import type { Block } from "../pdf/fallback";
import { sha256 } from "../auth/crypto";
import { storeFile, getFileDoc, readFile } from "../storage";
import { sendEmail } from "../email";
import { slugFileName } from "../text";
import { getSettings } from "./settings";
import { audit, type Actor } from "./audit";
import { nextInvoiceNumber } from "./counters";
import { companyRecipients } from "./companies";
import type { CompanyDoc, Currency, Discount, InvoiceDoc, LineItem, Tax } from "../types";

export interface InvoiceDraftInput {
  companyId: ObjectId;
  issueDate: string;
  dueDate: string;
  currency: Currency;
  items: Omit<LineItem, "amount">[];
  discount: Discount;
  tax: Tax;
  notes?: string;
  paymentInstructions?: string;
  billingPeriod?: string;
  remindersEnabled: boolean;
}

function validateDates(issueDate: string, dueDate: string) {
  if (!isDateString(issueDate)) throw new AppError("Please enter a valid issue date.", "issueDate");
  if (!isDateString(dueDate)) throw new AppError("Please enter a valid due date.", "dueDate");
  if (dueDate < issueDate) throw new AppError("The due date cannot be before the issue date.", "dueDate");
}

function buildFields(input: InvoiceDraftInput) {
  validateDates(input.issueDate, input.dueDate);
  if (input.items.length === 0) throw new AppError("Add at least one line item.", "items");
  const items = normaliseItems(input.items.map((i) => ({ ...i, title: i.title.trim(), detail: i.detail?.trim() || undefined, period: i.period?.trim() || undefined })));
  if (items.some((i) => !i.title)) throw new AppError("Every line item needs a title.", "items");
  const totals = computeTotals(items, input.discount, input.tax);
  return { items, totals };
}

export async function loadCompanyOrThrow(companyId: ObjectId, session?: ClientSession): Promise<CompanyDoc> {
  const c = await cols();
  const company = await c.companies.findOne({ _id: companyId }, { session });
  if (!company) throw new AppError("Please choose a company.", "companyId");
  return company;
}

export async function createGeneratedInvoice(
  actor: Actor,
  input: InvoiceDraftInput,
  extra: Partial<Pick<InvoiceDoc, "planId" | "period" | "proposalId" | "milestoneIndex" | "isDemo" | "replacesInvoiceId">> = {},
  session?: ClientSession,
): Promise<InvoiceDoc> {
  const company = await loadCompanyOrThrow(input.companyId, session);
  if (company.status === "archived") throw new AppError("This company is archived. Unarchive it to create invoices.");
  const settings = await getSettings();
  const { items, totals } = buildFields(input);
  const c = await cols();
  const now = new Date();
  const doc: InvoiceDoc = {
    _id: new ObjectId(),
    number: await nextInvoiceNumber(settings.numbering.invoicePrefix, Number(input.issueDate.slice(0, 4)), session),
    companyId: company._id,
    source: "generated",
    status: "draft",
    issueDate: input.issueDate,
    dueDate: input.dueDate,
    currency: input.currency,
    items,
    discount: input.discount,
    tax: input.tax,
    ...totals,
    paidTotal: 0,
    balance: totals.total,
    notes: input.notes?.trim() || undefined,
    paymentInstructions: input.paymentInstructions?.trim() || undefined,
    billingPeriod: input.billingPeriod?.trim() || undefined,
    remindersEnabled: input.remindersEnabled,
    createdBy: actor.userId,
    createdAt: now,
    updatedAt: now,
    ...extra,
  };
  await c.invoices.insertOne(doc, { session });
  await audit(actor, "invoice.create", "invoice", doc._id, undefined, { number: doc.number, total: doc.total, currency: doc.currency }, session);
  return doc;
}

export async function updateDraftInvoice(actor: Actor, id: ObjectId, input: InvoiceDraftInput): Promise<void> {
  const c = await cols();
  const before = await c.invoices.findOne({ _id: id });
  if (!before) throw new NotFoundError("Invoice not found.");
  if (before.status !== "draft") throw new AppError("Only drafts can be edited. Void this invoice and issue a new one to correct it.");
  if (before.source !== "generated") throw new AppError("Uploaded invoices cannot be edited here.");
  await loadCompanyOrThrow(input.companyId);
  const { items, totals } = buildFields(input);
  const set = {
    companyId: input.companyId,
    issueDate: input.issueDate,
    dueDate: input.dueDate,
    currency: input.currency,
    items,
    discount: input.discount,
    tax: input.tax,
    ...totals,
    balance: totals.total,
    notes: input.notes?.trim() || undefined,
    paymentInstructions: input.paymentInstructions?.trim() || undefined,
    billingPeriod: input.billingPeriod?.trim() || undefined,
    remindersEnabled: input.remindersEnabled,
    updatedAt: new Date(),
  };
  const res = await c.invoices.updateOne({ _id: id, status: "draft" }, { $set: set, $unset: { pdf: "" } });
  if (res.matchedCount !== 1) throw new AppError("This invoice was sent by someone else in the meantime.");
  await audit(actor, "invoice.update", "invoice", id, { total: before.total, items: before.items }, { total: set.total, items: set.items });
}

/** Uploaded invoice: a finished PDF plus the typed-in fields so it counts everywhere. */
export async function createUploadedInvoice(
  actor: Actor,
  input: { companyId: ObjectId; number: string; issueDate: string; dueDate: string; currency: Currency; total: number; description?: string; remindersEnabled: boolean; markSent: boolean },
  file: { bytes: Uint8Array; name: string },
): Promise<InvoiceDoc> {
  validateDates(input.issueDate, input.dueDate);
  const company = await loadCompanyOrThrow(input.companyId);
  if (!input.number.trim()) throw new AppError("Please enter the invoice number.", "number");
  if (input.total <= 0) throw new AppError("The total must be more than zero.", "total");
  const c = await cols();
  if (await c.invoices.findOne({ number: input.number.trim() })) throw new AppError("An invoice with this number already exists.", "number");
  const id = new ObjectId();
  const stored = await storeFile({ bytes: file.bytes, originalName: file.name, kind: "invoice_upload", companyId: company._id, relatedId: id, uploadedBy: actor.userId });
  if (stored.contentType !== "application/pdf") throw new AppError("Please upload the invoice as a PDF.", "file");
  const now = new Date();
  const doc: InvoiceDoc = {
    _id: id,
    number: input.number.trim(),
    companyId: company._id,
    source: "uploaded",
    status: "draft",
    issueDate: input.issueDate,
    dueDate: input.dueDate,
    currency: input.currency,
    items: [],
    discount: { type: "none", value: 0 },
    tax: { label: "", rateBp: 0 },
    subtotal: input.total,
    discountTotal: 0,
    taxTotal: 0,
    total: input.total,
    paidTotal: 0,
    balance: input.total,
    description: input.description?.trim() || undefined,
    fileId: stored._id,
    remindersEnabled: input.remindersEnabled,
    createdBy: actor.userId,
    createdAt: now,
    updatedAt: now,
  };
  await c.invoices.insertOne(doc);
  await audit(actor, "invoice.upload", "invoice", id, undefined, { number: doc.number, total: doc.total, currency: doc.currency });
  if (input.markSent) await sendInvoice(actor, id, { email: false });
  return doc;
}

export async function getInvoice(id: ObjectId) {
  const c = await cols();
  return c.invoices.findOne({ _id: id });
}

// ---------- Documents ----------

export async function invoiceDocData(inv: InvoiceDoc) {
  const c = await cols();
  const [company, settings] = await Promise.all([c.companies.findOne({ _id: inv.companyId }), getSettings()]);
  if (!company) throw new NotFoundError("Company not found.");
  const ms = await c.memberships.find({ companyId: company._id }).toArray();
  const primaryId = (ms.find((m) => m.isPrimary) ?? ms[0])?.userId;
  const contact = primaryId ? await c.users.findOne({ _id: primaryId }, { projection: { name: 1, email: 1 } }) : null;
  return { invoice: inv, company, contact, settings, today: today() };
}

function invoiceBlocks(data: Awaited<ReturnType<typeof invoiceDocData>>): Block[] {
  const { invoice: inv, company, contact, settings: s } = data;
  const m = (n: number) => formatMoney(n, inv.currency);
  const blocks: Block[] = [
    {
      type: "header",
      title: "Invoice",
      subtitle: s.legalName,
      meta: [["Invoice no.", inv.number], ["Issue date", formatDate(inv.issueDate)], ["Due date", formatDate(inv.dueDate)]],
      badge: invoiceBadge(inv, data.today).label,
    },
    {
      type: "columns",
      cols: [
        { label: "From", title: s.legalName, lines: [s.address, s.phone, s.email, s.website, s.registrationNumber ? `Reg. No: ${s.registrationNumber}` : "", s.taxNumber ? `Tax No: ${s.taxNumber}` : ""].filter(Boolean) },
        { label: "Bill to", title: company.name, lines: [contact?.name ? `Attn: ${contact.name}` : "", company.billingAddress, [company.city, company.country].filter(Boolean).join(", "), contact?.email ?? "", company.taxNumber ? `Tax No: ${company.taxNumber}` : ""].filter(Boolean) },
      ],
    },
  ];
  if (inv.billingPeriod) blocks.push({ type: "para", text: `Billing period: ${inv.billingPeriod}`, bold: true });
  blocks.push({
    type: "table",
    columns: [
      { label: "#", width: 4 },
      { label: "Description", width: 50 },
      { label: "Qty", width: 8, align: "right" },
      { label: "Unit price", width: 19, align: "right" },
      { label: "Amount", width: 19, align: "right" },
    ],
    rows: inv.items.map((it, i) => ({
      cells: [String(i + 1), it.title, formatQty(it.qty100), m(it.unitPrice), m(it.amount)],
      sub: [it.period ? `Period: ${it.period}` : "", ...(it.detail ?? "").split("\n")].filter((x) => x.trim()),
    })),
  });
  const totals: { label: string; value: string; strong?: boolean }[] = [{ label: "Subtotal", value: m(inv.subtotal) }];
  if (inv.discountTotal > 0) totals.push({ label: `Discount${inv.discount.type === "percent" ? ` (${formatRate(inv.discount.value)})` : ""}`, value: `-${m(inv.discountTotal)}` });
  if (inv.tax.rateBp > 0) totals.push({ label: `${inv.tax.label || "Tax"} (${formatRate(inv.tax.rateBp)})`, value: m(inv.taxTotal) });
  totals.push({ label: "Total", value: m(inv.total) });
  if (inv.paidTotal > 0) totals.push({ label: "Amount paid", value: `-${m(inv.paidTotal)}` });
  totals.push({ label: "Balance due", value: m(inv.balance), strong: true });
  blocks.push({ type: "totals", rows: totals });
  const bank: [string, string][] = ([
    ["Bank", s.bank.bankName], ["Branch", s.bank.branch], ["Account name", s.bank.accountName], ["Account number", s.bank.accountNumber], ["SWIFT code", s.bank.swift],
  ] as [string, string][]).filter(([, v]) => v && v.trim());
  if (bank.length) {
    blocks.push({ type: "heading", text: "Payment details" }, { type: "kv", rows: bank });
  }
  blocks.push({ type: "para", text: `Use the invoice number ${inv.number} as your payment reference.` });
  for (const n of [inv.notes, inv.paymentInstructions]) if (n?.trim()) blocks.push({ type: "para", text: n, muted: true });
  if (inv.status === "void" && inv.voidReason) blocks.push({ type: "para", text: `VOID: ${inv.voidReason}`, bold: true });
  if (s.invoiceThankYou) blocks.push({ type: "para", text: s.invoiceThankYou, bold: true });
  if (inv.status === "paid") blocks.push({ type: "stamp", text: "PAID", sub: inv.lastPaymentDate ? formatDate(inv.lastPaymentDate) : undefined });
  return blocks;
}

export function invoiceFileName(inv: InvoiceDoc, companyName: string) {
  return `${inv.number}_${slugFileName(companyName)}.pdf`;
}

/** Renders the PDF once per content version and stores it in R2. Uploaded invoices use their file. */
export async function ensureInvoicePdf(inv: InvoiceDoc): Promise<{ fileId: ObjectId; filename: string }> {
  const c = await cols();
  const company = await c.companies.findOne({ _id: inv.companyId });
  const filename = invoiceFileName(inv, company?.name ?? "Client");
  if (inv.source === "uploaded") {
    if (!inv.fileId) throw new NotFoundError("The uploaded file is missing.");
    return { fileId: inv.fileId, filename };
  }
  const data = await invoiceDocData(inv);
  const html = forPrint(renderInvoiceHtml(data));
  const hash = sha256(html);
  if (inv.pdf && inv.pdf.hash === hash && (await getFileDoc(inv.pdf.fileId))) return { fileId: inv.pdf.fileId, filename };
  const { bytes } = await renderPdf({
    html,
    blocks: invoiceBlocks(data),
    title: `Invoice ${inv.number}`,
    footerLeft: `${data.settings.legalName} · ${inv.number}`,
  });
  const file = await storeFile({ bytes, originalName: filename, kind: "invoice_pdf", companyId: inv.companyId, relatedId: inv._id });
  await c.invoices.updateOne({ _id: inv._id }, { $set: { pdf: { fileId: file._id, hash } } });
  return { fileId: file._id, filename };
}

export async function invoicePdfBytes(inv: InvoiceDoc) {
  const { fileId, filename } = await ensureInvoicePdf(inv);
  const f = await getFileDoc(fileId);
  if (!f) throw new NotFoundError();
  return { bytes: await readFile(f), filename };
}

// ---------- Sending ----------

/** Earlier unpaid invoices for the same company (for the monthly email). */
export async function unpaidSummary(inv: InvoiceDoc): Promise<string> {
  const c = await cols();
  const others = await c.invoices
    .find({ companyId: inv.companyId, _id: { $ne: inv._id }, status: { $in: OPEN_STATUSES }, balance: { $gt: 0 }, currency: inv.currency })
    .toArray();
  if (others.length === 0) return "";
  const sum = others.reduce((s, o) => s + o.balance, 0);
  return `You also have ${others.length} earlier unpaid invoice${others.length > 1 ? "s" : ""} with a balance of ${formatMoney(sum, inv.currency)}. You can see them all in the portal.`;
}

export async function sendInvoice(actor: Actor, id: ObjectId, opts: { email: boolean } = { email: true }) {
  const c = await cols();
  const inv = await c.invoices.findOne({ _id: id });
  if (!inv) throw new NotFoundError("Invoice not found.");
  if (inv.status === "void") throw new AppError("A void invoice cannot be sent.");
  const company = await c.companies.findOne({ _id: inv.companyId });
  if (!company) throw new NotFoundError();
  const firstSend = inv.status === "draft";
  // Check recipients and build the PDF before locking the invoice, so a failure here leaves
  // a draft as a draft instead of "sent" with no email.
  let prepared: { r: Awaited<ReturnType<typeof companyRecipients>>; fileId: ObjectId; filename: string } | null = null;
  if (opts.email) {
    const r = await companyRecipients(inv.companyId);
    if (r.to.length === 0) throw new AppError("This company has no contacts or billing emails to send to.");
    const { fileId, filename } = await ensureInvoicePdf(firstSend ? { ...inv, status: "sent" } : inv);
    prepared = { r, fileId, filename };
  }
  if (firstSend) {
    const res = await c.invoices.updateOne({ _id: id, status: "draft" }, { $set: { status: "sent", sentAt: new Date(), updatedAt: new Date() } });
    if (res.modifiedCount !== 1) throw new AppError("This invoice was already sent.");
    inv.status = "sent";
  }
  await audit(actor, firstSend ? "invoice.send" : "invoice.resend", "invoice", id, undefined, { email: opts.email });
  if (!prepared) return null;
  const { r, fileId, filename } = prepared;
  return sendEmail({
    template: "invoice_sent",
    to: r.to,
    cc: r.cc,
    vars: {
      client_name: r.primaryName,
      company_name: company.name,
      invoice_number: inv.number,
      amount_due: formatMoney(inv.balance, inv.currency),
      due_date: formatDate(inv.dueDate),
      portal_link: appUrl(`/portal/invoices/${inv._id}`),
      action_link: appUrl(`/portal/invoices/${inv._id}`),
      unpaid_summary: inv.planId ? await unpaidSummary(inv) : "",
    },
    attachments: [{ filename, fileId }],
    related: { type: "invoice", id: inv._id },
  });
}

export async function markViewed(id: ObjectId) {
  const c = await cols();
  await c.invoices.updateOne({ _id: id, status: "sent" }, { $set: { status: "viewed", viewedAt: new Date() } });
}

export async function voidInvoice(actor: Actor, id: ObjectId, reason: string) {
  if (!reason.trim()) throw new AppError("Please give a reason for voiding.", "reason");
  const c = await cols();
  const inv = await c.invoices.findOne({ _id: id });
  if (!inv) throw new NotFoundError();
  if (inv.status === "void") throw new AppError("This invoice is already void.");
  if (inv.paidTotal > 0) throw new AppError("This invoice has payments recorded. Payments must be handled before voiding.");
  await c.invoices.updateOne({ _id: id }, { $set: { status: "void", voidReason: reason.trim(), updatedAt: new Date() }, $unset: { pdf: "" } });
  await c.paymentSubmissions.updateMany({ invoiceId: id, status: "pending" }, { $set: { status: "rejected", rejectReason: "The invoice was voided.", reviewedAt: new Date() } });
  await audit(actor, "invoice.void", "invoice", id, { status: inv.status }, { status: "void", reason });
}

/** Copies a voided invoice into a new draft for correction. */
export async function duplicateAsDraft(actor: Actor, id: ObjectId) {
  const inv = await getInvoice(id);
  if (!inv || inv.source !== "generated") throw new AppError("Only generated invoices can be duplicated.");
  const t = today();
  const settings = await getSettings();
  const company = await loadCompanyOrThrow(inv.companyId);
  return createGeneratedInvoice(actor, {
    companyId: inv.companyId,
    issueDate: t,
    dueDate: addDays(t, company.paymentTermsDays ?? settings.defaultPaymentTermsDays),
    currency: inv.currency,
    items: inv.items.map(({ amount: _a, ...rest }) => rest),
    discount: inv.discount,
    tax: inv.tax,
    notes: inv.notes,
    paymentInstructions: inv.paymentInstructions,
    billingPeriod: inv.billingPeriod,
    remindersEnabled: inv.remindersEnabled,
  }, { replacesInvoiceId: inv.status === "void" ? inv._id : undefined });
}

export async function setRemindersEnabled(actor: Actor, id: ObjectId, enabled: boolean) {
  const c = await cols();
  await c.invoices.updateOne({ _id: id }, { $set: { remindersEnabled: enabled, updatedAt: new Date() } });
  await audit(actor, enabled ? "invoice.reminders_on" : "invoice.reminders_off", "invoice", id);
}

export async function clearFollowUp(actor: Actor, id: ObjectId) {
  const c = await cols();
  await c.invoices.updateOne({ _id: id }, { $set: { followUp: false } });
  await audit(actor, "invoice.follow_up_cleared", "invoice", id);
}

// ---------- Queries ----------

export type InvoiceTab = "all" | "pending" | "paid" | "overdue" | "draft" | "void";

export function invoiceFilter(opts: { companyIds?: ObjectId[]; tab?: InvoiceTab; q?: string; from?: string; to?: string; clientView?: boolean }): Filter<InvoiceDoc> {
  const f: Filter<InvoiceDoc> = {};
  const and: Filter<InvoiceDoc>[] = [];
  if (opts.companyIds) f.companyId = { $in: opts.companyIds };
  if (opts.clientView) and.push({ status: { $ne: "draft" } });
  const t = today();
  switch (opts.tab) {
    case "pending": and.push({ status: { $in: OPEN_STATUSES }, balance: { $gt: 0 } }); break;
    case "paid": and.push({ status: "paid" }); break;
    case "overdue": and.push({ status: { $in: OPEN_STATUSES }, balance: { $gt: 0 }, dueDate: { $lt: t } }); break;
    case "draft": and.push({ status: "draft" }); break;
    case "void": and.push({ status: "void" }); break;
  }
  if (opts.q) and.push({ $or: [{ number: { $regex: opts.q.replace(/[^\w-]/g, ""), $options: "i" } }, { description: { $regex: opts.q.replace(/[^\w -]/g, ""), $options: "i" } }] });
  if (opts.from && isDateString(opts.from)) and.push({ issueDate: { $gte: opts.from } });
  if (opts.to && isDateString(opts.to)) and.push({ issueDate: { $lte: opts.to } });
  if (and.length) f.$and = and;
  return f;
}

export async function listInvoices(filter: Filter<InvoiceDoc>, limit = 300) {
  const c = await cols();
  return c.invoices.find(filter).sort({ issueDate: -1, number: -1 }).limit(limit).toArray();
}

/** Outstanding / overdue / etc. grouped by currency (never mixes currencies). */
export function sumByCurrency<T>(items: T[], pick: (i: T) => { currency: string; amount: number } | null) {
  const out: Record<string, number> = {};
  for (const i of items) {
    const p = pick(i);
    if (!p) continue;
    out[p.currency] = (out[p.currency] ?? 0) + p.amount;
  }
  return out;
}

export function companyInvoiceStats(invoices: InvoiceDoc[], t = today()) {
  const live = invoices.filter((i) => i.status !== "draft" && i.status !== "void");
  return {
    outstanding: sumByCurrency(live, (i) => (i.balance > 0 ? { currency: i.currency, amount: i.balance } : null)),
    overdue: sumByCurrency(live, (i) => (isOverdue(i, t) ? { currency: i.currency, amount: i.balance } : null)),
    billed: sumByCurrency(live, (i) => ({ currency: i.currency, amount: i.total })),
    paid: sumByCurrency(live, (i) => ({ currency: i.currency, amount: i.paidTotal })),
  };
}

export { displayStatus };

/** Throws unless the client scope includes the invoice's company. */
export function assertInvoiceAccess(inv: InvoiceDoc | null, companyIds: ObjectId[]): asserts inv is InvoiceDoc {
  if (!inv || !companyIds.some((id) => id.equals(inv.companyId)) || inv.status === "draft") throw new ForbiddenError();
}

export async function deleteDraftInvoice(actor: Actor, id: ObjectId) {
  // Drafts never sent are not financial records yet, but numbers are never reused; we void instead.
  return withTransaction(async (session) => {
    const c = await cols();
    const inv = await c.invoices.findOne({ _id: id }, { session });
    if (!inv || inv.status !== "draft") throw new AppError("Only drafts can be discarded.");
    await c.invoices.updateOne({ _id: id }, { $set: { status: "void", voidReason: "Draft discarded", updatedAt: new Date() } }, { session });
    await audit(actor, "invoice.discard_draft", "invoice", id, undefined, undefined, session);
  });
}
