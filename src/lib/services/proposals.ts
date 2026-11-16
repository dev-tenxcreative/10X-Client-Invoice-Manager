import { ObjectId } from "mongodb";
import { cols } from "../db";
import { appUrl } from "../env";
import { AppError, ForbiddenError, NotFoundError } from "../errors";
import { computeTotals, formatMoney, formatQty, formatRate, normaliseItems, splitByMilestones } from "../money";
import { addDays, formatDate, formatDateTime, isDateString, today } from "../dates";
import { sha256 } from "../auth/crypto";
import { richTextToPlain, slugFileName } from "../text";
import { renderProposalHtml, proposalHeaderLine } from "../documents/proposal-html";
import { PROPOSAL_TEMPLATES, TABLE_SECTIONS, templateSections } from "../documents/proposal-templates";
import { renderPdf } from "../pdf/render";
import type { Block } from "../pdf/fallback";
import { storeFile, getFileDoc, readFile } from "../storage";
import { adminEmails, sendEmail } from "../email";
import { getSettings } from "./settings";
import { audit, type Actor } from "./audit";
import { nextProposalReference } from "./counters";
import { companyRecipients } from "./companies";
import { createGeneratedInvoice } from "./invoices";
import { createPlan } from "./plans";
import type { Currency, ProposalContent, ProposalDoc } from "../types";

export const PROPOSAL_STATUS_LABEL: Record<ProposalDoc["status"], string> = {
  draft: "Draft",
  sent: "Sent",
  viewed: "Viewed",
  accepted: "Accepted",
  declined: "Declined",
  expired: "Expired",
};

function validateContent(content: ProposalContent) {
  if (!content.title.trim()) throw new AppError("Please give the proposal a title.", "title");
  if (!isDateString(content.date)) throw new AppError("Please enter a valid date.", "date");
  if (!isDateString(content.validUntil)) throw new AppError("Please enter a valid 'valid until' date.", "validUntil");
  if (content.validUntil < content.date) throw new AppError("'Valid until' cannot be before the proposal date.", "validUntil");
  const investment = normaliseItems(content.investment.filter((i) => i.title.trim()));
  const totals = computeTotals(investment, content.discount, content.tax);
  const pctSum = content.paymentSchedule.filter((m) => m.type === "percent").reduce((s, m) => s + m.value, 0);
  const amtSum = content.paymentSchedule.filter((m) => m.type === "amount").reduce((s, m) => s + m.value, 0);
  if (content.paymentSchedule.length && content.paymentSchedule.every((m) => m.type === "percent") && pctSum !== 10000) {
    throw new AppError("Payment schedule percentages must add up to 100%.", "paymentSchedule");
  }
  if (amtSum > totals.total) throw new AppError("Payment schedule amounts are more than the total.", "paymentSchedule");
  return { content: { ...content, investment }, totals };
}

export async function createBuiltProposal(actor: Actor, input: { companyId: ObjectId; template: string; title: string; currency?: Currency; isDemo?: boolean }) {
  const c = await cols();
  const company = await c.companies.findOne({ _id: input.companyId });
  if (!company) throw new AppError("Please choose a company.", "companyId");
  const settings = await getSettings();
  const tpl = PROPOSAL_TEMPLATES[input.template] ?? PROPOSAL_TEMPLATES.blank;
  const t = today();
  const content: ProposalContent = {
    title: input.title.trim() || tpl.projectTitle || "Proposal",
    projectTitle: tpl.projectTitle,
    date: t,
    validUntil: addDays(t, 30),
    currency: input.currency ?? company.currency,
    sections: templateSections(input.template),
    investment: normaliseItems(tpl.investment),
    investmentNotes: tpl.investmentNotes,
    discount: { type: "none", value: 0 },
    tax: { ...settings.tax },
    timeline: tpl.timeline,
    paymentSchedule: tpl.paymentSchedule,
  };
  const totals = computeTotals(content.investment, content.discount, content.tax);
  const now = new Date();
  const doc: ProposalDoc = {
    _id: new ObjectId(),
    reference: await nextProposalReference(settings.numbering.proposalPrefix, Number(t.slice(0, 4))),
    companyId: company._id,
    source: "built",
    template: input.template,
    status: "draft",
    version: 1,
    content,
    versions: [],
    ...totals,
    isDemo: input.isDemo,
    createdBy: actor.userId,
    createdAt: now,
    updatedAt: now,
  };
  await c.proposals.insertOne(doc);
  await audit(actor, "proposal.create", "proposal", doc._id, undefined, { reference: doc.reference });
  return doc;
}

/**
 * Saves the builder. Drafts update in place (autosave). Editing a sent proposal creates a new
 * version; the previous one is kept read-only in `versions` and the proposal returns to Draft.
 */
export async function saveProposalContent(actor: Actor, id: ObjectId, raw: ProposalContent, reference?: string) {
  const c = await cols();
  const p = await c.proposals.findOne({ _id: id });
  if (!p) throw new NotFoundError("Proposal not found.");
  if (p.source !== "built") throw new AppError("Uploaded proposals cannot be edited here.");
  if (p.status === "accepted" || p.status === "declined") throw new AppError("Accepted or declined proposals cannot be edited.");
  const { content, totals } = validateContent(raw);
  const set: Partial<ProposalDoc> = { content, ...totals, updatedAt: new Date() };
  if (p.status === "draft") {
    if (reference && reference.trim() !== p.reference) {
      const ref = reference.trim();
      if (!/^[A-Za-z0-9-]{3,40}$/.test(ref)) throw new AppError("The reference can only use letters, numbers and dashes.", "reference");
      if (await c.proposals.findOne({ reference: ref, _id: { $ne: id } })) throw new AppError("Another proposal already uses this reference.", "reference");
      set.reference = ref;
    }
    await c.proposals.updateOne({ _id: id }, { $set: set, $unset: { pdf: "" } });
    return { versioned: false };
  }
  await c.proposals.updateOne(
    { _id: id },
    {
      $set: { ...set, status: "draft", version: p.version + 1 },
      $push: { versions: { version: p.version, content: p.content, totals: { subtotal: p.subtotal, discountTotal: p.discountTotal, taxTotal: p.taxTotal, total: p.total }, savedAt: new Date() } },
      $unset: { pdf: "" },
    },
  );
  await audit(actor, "proposal.new_version", "proposal", id, { version: p.version }, { version: p.version + 1 });
  return { versioned: true };
}

export async function createUploadedProposal(
  actor: Actor,
  input: { companyId: ObjectId; title: string; reference: string; date: string; validUntil: string; total: number; currency: Currency },
  file: { bytes: Uint8Array; name: string },
) {
  const c = await cols();
  const company = await c.companies.findOne({ _id: input.companyId });
  if (!company) throw new AppError("Please choose a company.", "companyId");
  if (!input.title.trim()) throw new AppError("Please enter the title.", "title");
  if (!isDateString(input.date) || !isDateString(input.validUntil)) throw new AppError("Please enter valid dates.", "date");
  if (input.total <= 0) throw new AppError("The total must be more than zero.", "total");
  const settings = await getSettings();
  const reference = input.reference.trim() || (await nextProposalReference(settings.numbering.proposalPrefix, Number(input.date.slice(0, 4))));
  if (await c.proposals.findOne({ reference })) throw new AppError("A proposal with this reference already exists.", "reference");
  const id = new ObjectId();
  const stored = await storeFile({ bytes: file.bytes, originalName: file.name, kind: "proposal_upload", companyId: company._id, relatedId: id, uploadedBy: actor.userId });
  if (stored.contentType !== "application/pdf") throw new AppError("Please upload the proposal as a PDF.", "file");
  const now = new Date();
  const content: ProposalContent = {
    title: input.title.trim(), projectTitle: "", date: input.date, validUntil: input.validUntil, currency: input.currency,
    sections: [], investment: [], discount: { type: "none", value: 0 }, tax: { label: "", rateBp: 0 }, timeline: [], paymentSchedule: [],
  };
  const doc: ProposalDoc = {
    _id: id, reference, companyId: company._id, source: "uploaded", template: "upload", status: "draft", version: 1, content, versions: [],
    subtotal: input.total, discountTotal: 0, taxTotal: 0, total: input.total, fileId: stored._id, createdBy: actor.userId, createdAt: now, updatedAt: now,
  };
  await c.proposals.insertOne(doc);
  await audit(actor, "proposal.upload", "proposal", id, undefined, { reference });
  return doc;
}

export async function proposalDocData(p: ProposalDoc) {
  const c = await cols();
  const [company, settings] = await Promise.all([c.companies.findOne({ _id: p.companyId }), getSettings()]);
  if (!company) throw new NotFoundError();
  const r = await companyRecipients(p.companyId);
  return { proposal: p, content: p.content, totals: { subtotal: p.subtotal, discountTotal: p.discountTotal, taxTotal: p.taxTotal, total: p.total }, company, contactName: r.primary?.name, settings };
}

function proposalBlocks(d: Awaited<ReturnType<typeof proposalDocData>>): Block[] {
  const { content: c, totals: t, company, settings: s, proposal: p } = d;
  const m = (n: number) => formatMoney(n, c.currency);
  const blocks: Block[] = [
    { type: "header", title: "Proposal", subtitle: s.legalName, meta: [["Reference", p.reference], ["Date", formatDate(c.date)], ["Valid until", formatDate(c.validUntil)]] },
    { type: "para", text: `Proposal for ${company.name}`, bold: true, size: 16 },
    ...(c.projectTitle ? [{ type: "para", text: c.projectTitle, muted: true, size: 12 } as Block] : []),
    { type: "columns", cols: [
      { label: "Prepared for", title: company.name, lines: [d.contactName ? `Attn: ${d.contactName}` : "", [company.billingAddress, company.city, company.country].filter(Boolean).join(", ")].filter(Boolean) },
      { label: "Prepared by", title: s.legalName, lines: [`${s.signatoryName}, ${s.signatoryTitle}`, s.address, s.phone, s.website].filter(Boolean) },
    ] },
    { type: "pagebreak" },
  ];
  const amounts = splitByMilestones(t.total, c.paymentSchedule);
  c.sections.filter((x) => !x.hidden).forEach((sec, i) => {
    if (sec.key === "terms" || sec.key === "acceptance") blocks.push({ type: "pagebreak" });
    blocks.push({ type: "heading", text: `${i + 1}. ${sec.title}` });
    if (sec.body) blocks.push({ type: "para", text: richTextToPlain(sec.body) });
    if (TABLE_SECTIONS.has(sec.key)) {
      if (sec.key === "investment") {
        blocks.push({ type: "table", columns: [{ label: "#", width: 5 }, { label: "Module", width: 60 }, { label: "Qty", width: 10, align: "right" }, { label: "Amount", width: 25, align: "right" }],
          rows: c.investment.map((it, n) => ({ cells: [String(n + 1), it.title, formatQty(it.qty100), m(it.amount)], sub: it.detail ? it.detail.split("\n") : [] })) });
        const rows = [{ label: "Subtotal", value: m(t.subtotal) }];
        if (t.discountTotal > 0) rows.push({ label: "Discount", value: `-${m(t.discountTotal)}` });
        if (c.tax.rateBp > 0) rows.push({ label: `${c.tax.label} (${formatRate(c.tax.rateBp)})`, value: m(t.taxTotal) });
        blocks.push({ type: "totals", rows: [...rows, { label: "Total", value: m(t.total), strong: true } as never] });
        if (c.investmentNotes) blocks.push({ type: "para", text: `Note: ${c.investmentNotes}`, muted: true });
      }
      if (sec.key === "timeline" && c.timeline.length) {
        blocks.push({ type: "table", columns: [{ label: "#", width: 5 }, { label: "Phase", width: 50 }, { label: "Duration", width: 20 }, { label: "Notes", width: 25 }],
          rows: c.timeline.map((r, n) => ({ cells: [String(n + 1), r.phase, r.duration, r.notes ?? ""] })) });
      }
      if (sec.key === "payment_schedule" && c.paymentSchedule.length) {
        blocks.push({ type: "table", columns: [{ label: "#", width: 5 }, { label: "Milestone", width: 45 }, { label: "Share", width: 15, align: "right" }, { label: "Amount", width: 35, align: "right" }],
          rows: c.paymentSchedule.map((ms, n) => ({ cells: [String(n + 1), ms.label, ms.type === "percent" ? formatRate(ms.value) : "", m(amounts[n])] })) });
      }
    }
    if (sec.key === "acceptance") {
      const a = p.acceptance;
      blocks.push({ type: "columns", cols: [
        { label: `For the client: ${company.name}`, lines: a ? [`Accepted ${a.method === "online" ? "online" : "(signed copy on file)"}`, `Name: ${a.name}`, `Designation: ${a.designation}`, `Date: ${formatDateTime(a.at)}`] : ["Signature: ______________________", "", "Name: ______________________", "", "Date: ______________________"] },
        { label: `For ${s.legalName}`, lines: ["Signature: ______________________", "", `${s.signatoryName}, ${s.signatoryTitle}`, "", "Date: ______________________"] },
      ] });
    }
  });
  if (p.acceptance?.method === "online") {
    const a = p.acceptance;
    blocks.push({ type: "pagebreak" }, { type: "heading", text: "Digital acceptance record" },
      { type: "kv", rows: [["Proposal", `${p.reference} (version ${a.version})`], ["Accepted by", a.name], ["Designation", a.designation], ["Company", company.name], ["Date and time", `${formatDateTime(a.at)} (Asia/Colombo)`], ...(a.ip ? [["IP address", a.ip] as [string, string]] : []), ["Confirmation", "Ticked \"I agree\""]] });
  }
  return blocks;
}

export function proposalFileName(p: ProposalDoc, companyName: string) {
  return `${p.reference}_${slugFileName(companyName)}.pdf`;
}

export async function ensureProposalPdf(p: ProposalDoc) {
  const c = await cols();
  const company = await c.companies.findOne({ _id: p.companyId });
  const filename = proposalFileName(p, company?.name ?? "Client");
  if (p.source === "uploaded") return { fileId: p.fileId!, filename };
  const data = await proposalDocData(p);
  const html = renderProposalHtml(data, "print");
  const hash = sha256(html);
  if (p.pdf && p.pdf.hash === hash && (await getFileDoc(p.pdf.fileId))) return { fileId: p.pdf.fileId, filename };
  const { bytes } = await renderPdf({ html, blocks: proposalBlocks(data), title: `Proposal ${p.reference}`, footerLeft: `${data.settings.legalName} · ${p.reference}`, headerLine: proposalHeaderLine(data) });
  const file = await storeFile({ bytes, originalName: filename, kind: "proposal_pdf", companyId: p.companyId, relatedId: p._id });
  await c.proposals.updateOne({ _id: p._id }, { $set: { pdf: { fileId: file._id, hash } } });
  return { fileId: file._id, filename };
}

export async function proposalPdfBytes(p: ProposalDoc) {
  const { fileId, filename } = await ensureProposalPdf(p);
  const f = await getFileDoc(fileId);
  if (!f) throw new NotFoundError();
  return { bytes: await readFile(f), filename };
}

export async function sendProposal(actor: Actor, id: ObjectId, attachPdf: boolean) {
  const c = await cols();
  const p = await c.proposals.findOne({ _id: id });
  if (!p) throw new NotFoundError();
  if (["accepted", "declined"].includes(p.status)) throw new AppError("This proposal already has a response.");
  if (p.content.validUntil < today()) throw new AppError("The 'valid until' date has passed. Edit the proposal to extend it before sending.");
  const company = await c.companies.findOne({ _id: p.companyId });
  const r = await companyRecipients(p.companyId);
  if (r.to.length === 0) throw new AppError("This company has no contacts to send to.");
  await c.proposals.updateOne({ _id: id }, { $set: { status: "sent", sentAt: new Date(), updatedAt: new Date() } });
  await audit(actor, "proposal.send", "proposal", id, { status: p.status }, { status: "sent", version: p.version });
  const attachments = attachPdf ? [await ensureProposalPdf({ ...p, status: "sent" })] : [];
  return sendEmail({
    template: "proposal_sent",
    to: r.to,
    cc: r.cc,
    vars: {
      client_name: r.primaryName,
      company_name: company?.name,
      proposal_reference: p.reference,
      proposal_title: p.content.title,
      proposal_total: formatMoney(p.total, p.content.currency),
      valid_until: formatDate(p.content.validUntil),
      action_link: appUrl(`/portal/proposals/${p._id}`),
      portal_link: appUrl(`/portal/proposals/${p._id}`),
    },
    attachments,
    related: { type: "proposal", id: p._id },
  });
}

export async function markProposalViewed(id: ObjectId) {
  const c = await cols();
  await c.proposals.updateOne({ _id: id, status: "sent" }, { $set: { status: "viewed", viewedAt: new Date() } });
}

export function assertProposalAccess(p: ProposalDoc | null, companyIds: ObjectId[]): asserts p is ProposalDoc {
  if (!p || p.status === "draft" || !companyIds.some((id) => id.equals(p.companyId))) throw new ForbiddenError();
}

async function notifyAdmins(p: ProposalDoc, response: string, details: string) {
  const c = await cols();
  const company = await c.companies.findOne({ _id: p.companyId });
  const admins = await adminEmails();
  if (!admins.length) return;
  await sendEmail({
    template: "proposal_response_admin",
    to: admins,
    vars: { company_name: company?.name, response, proposal_reference: p.reference, proposal_title: p.content.title, details, action_link: appUrl(`/admin/proposals/${p._id}`) },
    related: { type: "proposal", id: p._id },
  }).catch(() => {});
}

export async function acceptOnline(actor: Actor, companyIds: ObjectId[], id: ObjectId, input: { name: string; designation: string; agree: boolean }) {
  const c = await cols();
  const p = await c.proposals.findOne({ _id: id });
  assertProposalAccess(p, companyIds);
  if (!["sent", "viewed"].includes(p.status)) throw new AppError("This proposal can no longer be accepted.");
  if (p.content.validUntil < today()) throw new AppError("This proposal has expired. Please contact us for an updated one.");
  if (!input.agree) throw new AppError("Please tick \"I agree\" to accept.", "agree");
  if (input.name.trim().length < 2) throw new AppError("Please type your full name.", "name");
  if (!input.designation.trim()) throw new AppError("Please type your designation.", "designation");
  const acceptance = { name: input.name.trim(), designation: input.designation.trim(), at: new Date(), ip: actor.ip, version: p.version, method: "online" as const, userId: actor.userId };
  const res = await c.proposals.updateOne({ _id: id, status: { $in: ["sent", "viewed"] } }, { $set: { status: "accepted", acceptance, updatedAt: new Date() }, $unset: { pdf: "" } });
  if (res.modifiedCount !== 1) throw new AppError("This proposal can no longer be accepted.");
  await audit(actor, "proposal.accept", "proposal", id, { status: p.status }, acceptance);
  await notifyAdmins(p, "accepted", `Accepted by ${acceptance.name} (${acceptance.designation}) on ${formatDateTime(acceptance.at)}.`);
}

export async function declineOnline(actor: Actor, companyIds: ObjectId[], id: ObjectId, reason: string) {
  const c = await cols();
  const p = await c.proposals.findOne({ _id: id });
  assertProposalAccess(p, companyIds);
  if (!["sent", "viewed"].includes(p.status)) throw new AppError("This proposal can no longer be declined.");
  const decline = { reason: reason.trim() || undefined, at: new Date(), userId: actor.userId };
  await c.proposals.updateOne({ _id: id }, { $set: { status: "declined", decline, updatedAt: new Date() } });
  await audit(actor, "proposal.decline", "proposal", id, { status: p.status }, decline);
  await notifyAdmins(p, "declined", decline.reason ? `Reason: ${decline.reason}` : "No reason was given.");
}

export async function markAcceptedManually(actor: Actor, id: ObjectId, input: { name: string; designation: string; date: string }, signed?: { bytes: Uint8Array; name: string }) {
  const c = await cols();
  const p = await c.proposals.findOne({ _id: id });
  if (!p) throw new NotFoundError();
  if (p.status === "accepted") throw new AppError("This proposal is already accepted.");
  if (!input.name.trim()) throw new AppError("Please enter who signed it.", "name");
  if (!isDateString(input.date)) throw new AppError("Please enter the date it was signed.", "date");
  const file = signed ? await storeFile({ bytes: signed.bytes, originalName: signed.name, kind: "proposal_signed", companyId: p.companyId, relatedId: p._id, uploadedBy: actor.userId }) : null;
  const acceptance = { name: input.name.trim(), designation: input.designation.trim(), at: new Date(input.date + "T12:00:00+05:30"), version: p.version, method: "manual" as const };
  await c.proposals.updateOne({ _id: id }, { $set: { status: "accepted", acceptance, ...(file ? { signedFileId: file._id } : {}), updatedAt: new Date() }, $unset: { pdf: "" } });
  await audit(actor, "proposal.accept_manual", "proposal", id, { status: p.status }, acceptance);
}

/** One draft invoice per payment-schedule milestone. Runs once per proposal. */
export async function createInvoicesFromSchedule(actor: Actor, id: ObjectId) {
  const c = await cols();
  const p = await c.proposals.findOne({ _id: id });
  if (!p) throw new NotFoundError();
  if (p.status !== "accepted") throw new AppError("Only accepted proposals can be turned into invoices.");
  if (p.source !== "built") throw new AppError("Uploaded proposals have no payment schedule. Create the invoices manually.");
  if (p.content.paymentSchedule.length === 0) throw new AppError("This proposal has no payment schedule.");
  const claim = await c.proposals.updateOne({ _id: id, invoicesCreatedAt: { $exists: false } }, { $set: { invoicesCreatedAt: new Date() } });
  if (claim.modifiedCount !== 1) throw new AppError("Invoices were already created from this proposal.");
  const company = await c.companies.findOne({ _id: p.companyId });
  const settings = await getSettings();
  const t = today();
  // Amounts are split from the pre-tax total so each invoice can apply the tax itself.
  const preTax = p.subtotal - p.discountTotal;
  const amounts = splitByMilestones(preTax, p.content.paymentSchedule);
  const created = [];
  try {
    for (const [i, m] of p.content.paymentSchedule.entries()) {
      const inv = await createGeneratedInvoice(actor, {
        companyId: p.companyId,
        issueDate: t,
        dueDate: addDays(t, company?.paymentTermsDays ?? settings.defaultPaymentTermsDays),
        currency: p.content.currency,
        items: [{ title: `${p.content.projectTitle || p.content.title}: ${m.label}`, detail: `As per proposal ${p.reference}${m.type === "percent" ? ` (${formatRate(m.value)} of the project total)` : ""}`, qty100: 100, unitPrice: amounts[i] }],
        discount: { type: "none", value: 0 },
        tax: p.content.tax,
        remindersEnabled: true,
      }, { proposalId: p._id, milestoneIndex: i });
      created.push(inv);
    }
  } catch (e) {
    if (created.length === 0) await c.proposals.updateOne({ _id: id }, { $unset: { invoicesCreatedAt: "" } });
    throw e;
  }
  await audit(actor, "proposal.create_invoices", "proposal", id, undefined, { invoices: created.map((x) => x.number) });
  return created;
}

export async function createPlanFromProposal(actor: Actor, id: ObjectId, input: { startDate: string; billingDay: number; dueAfterDays: number; mode: "auto" | "review" }) {
  const c = await cols();
  const p = await c.proposals.findOne({ _id: id });
  if (!p) throw new NotFoundError();
  if (p.status !== "accepted") throw new AppError("Only accepted proposals can become recurring plans.");
  if (p.planId) throw new AppError("A plan was already created from this proposal.");
  if (p.content.investment.length === 0) throw new AppError("This proposal has no investment lines.");
  const plan = await createPlan(actor, {
    companyId: p.companyId,
    name: p.content.projectTitle || p.content.title,
    items: p.content.investment.map(({ amount: _a, ...i }) => i),
    currency: p.content.currency,
    discount: p.content.discount,
    tax: p.content.tax,
    startDate: input.startDate,
    billingDay: input.billingDay,
    dueAfterDays: input.dueAfterDays,
    mode: input.mode,
    notes: `As per proposal ${p.reference}`,
  }, { proposalId: p._id });
  await c.proposals.updateOne({ _id: id }, { $set: { planId: plan._id } });
  return plan;
}

export async function expireProposals(t = today()) {
  const c = await cols();
  const res = await c.proposals.updateMany({ status: { $in: ["sent", "viewed"] }, "content.validUntil": { $lt: t } }, { $set: { status: "expired", updatedAt: new Date() } });
  return { expired: res.modifiedCount };
}
