import { ObjectId } from "mongodb";
import { cols, withTransaction } from "../db";
import { AppError, NotFoundError } from "../errors";
import { audit, type Actor } from "./audit";
import { createActivationToken, createUser, normaliseEmail, sendActivationEmail } from "./users";
import type { CompanyDoc, Currency, UserDoc } from "../types";

export interface CompanyInput {
  name: string;
  billingAddress: string;
  city: string;
  country: string;
  taxNumber?: string;
  billingEmails: string[];
  currency: Currency;
  paymentTermsDays: number;
  notes?: string;
}

export interface ContactInput {
  name: string;
  email: string;
  phone?: string;
  designation?: string;
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function checkDuplicates(input: { email?: string; companyName?: string }) {
  const c = await cols();
  const out: { email?: string; companyName?: string } = {};
  if (input.email && (await c.users.findOne({ email: normaliseEmail(input.email) }))) {
    out.email = "A user with this email already exists. Use \"Add contact\" on their company instead.";
  }
  if (input.companyName && (await c.companies.findOne({ nameLower: input.companyName.trim().toLowerCase() }))) {
    out.companyName = "A company with this name already exists. Switch on \"Add to an existing company\".";
  }
  return out;
}

/**
 * "New client": company (new or existing) + contact user + membership + invitation token, in one
 * transaction. The invitation email is sent only after the transaction commits.
 */
export async function createClient(
  actor: Actor,
  input: { contact: ContactInput; company?: CompanyInput; existingCompanyId?: ObjectId; sendInvite: boolean; isDemo?: boolean },
): Promise<{ company: CompanyDoc; user: UserDoc; invited: boolean }> {
  const dup = await checkDuplicates({ email: input.contact.email, companyName: input.existingCompanyId ? undefined : input.company?.name });
  if (dup.email) throw new AppError(dup.email, "contact.email");
  if (dup.companyName) throw new AppError(dup.companyName, "company.name");

  const result = await withTransaction(async (session) => {
    const c = await cols();
    let company: CompanyDoc | null;
    if (input.existingCompanyId) {
      company = await c.companies.findOne({ _id: input.existingCompanyId }, { session });
      if (!company) throw new AppError("That company no longer exists.", "existingCompanyId");
    } else {
      if (!input.company) throw new AppError("Company details are required.");
      const now = new Date();
      company = {
        _id: new ObjectId(),
        ...input.company,
        name: input.company.name.trim(),
        nameLower: input.company.name.trim().toLowerCase(),
        status: "active",
        isDemo: input.isDemo,
        createdAt: now,
        updatedAt: now,
      };
      await c.companies.insertOne(company, { session });
    }
    const user = await createUser({ ...input.contact, role: "client", isDemo: input.isDemo }, session);
    await c.memberships.insertOne(
      { _id: new ObjectId(), userId: user._id, companyId: company._id, isPrimary: true, createdAt: new Date() },
      { session },
    );
    const token = input.sendInvite ? await createActivationToken(user._id, session) : null;
    await audit(actor, "client.create", "company", company._id, undefined, { company: company.name, contact: user.email, newCompany: !input.existingCompanyId }, session);
    return { company, user, token };
  });

  if (result.token) await sendActivationEmail(result.user, result.token);
  return { company: result.company, user: result.user, invited: Boolean(result.token) };
}

export async function addContact(actor: Actor, companyId: ObjectId, contact: ContactInput, sendInvite: boolean) {
  const c = await cols();
  const company = await c.companies.findOne({ _id: companyId });
  if (!company) throw new NotFoundError("Company not found.");
  const existing = await c.users.findOne({ email: normaliseEmail(contact.email) });
  if (existing) {
    if (existing.role !== "client") throw new AppError("This email belongs to an admin.", "email");
    // Link an existing contact to one more company.
    const already = await c.memberships.findOne({ userId: existing._id, companyId });
    if (already) throw new AppError("This contact is already linked to this company.", "email");
    await c.memberships.insertOne({ _id: new ObjectId(), userId: existing._id, companyId, isPrimary: false, createdAt: new Date() });
    await audit(actor, "contact.link", "company", companyId, undefined, { contact: existing.email });
    return { user: existing, linked: true };
  }
  const res = await withTransaction(async (session) => {
    const user = await createUser({ ...contact, role: "client" }, session);
    await c.memberships.insertOne({ _id: new ObjectId(), userId: user._id, companyId, isPrimary: false, createdAt: new Date() }, { session });
    const token = sendInvite ? await createActivationToken(user._id, session) : null;
    await audit(actor, "contact.create", "company", companyId, undefined, { contact: user.email }, session);
    return { user, token };
  });
  if (res.token) await sendActivationEmail(res.user, res.token);
  return { user: res.user, linked: false };
}

export async function unlinkContact(actor: Actor, companyId: ObjectId, userId: ObjectId) {
  const c = await cols();
  const count = await c.memberships.countDocuments({ userId });
  if (count <= 1) throw new AppError("Every client contact must belong to at least one company. Deactivate the contact instead.");
  await c.memberships.deleteOne({ userId, companyId });
  await audit(actor, "contact.unlink", "company", companyId, { userId }, undefined);
}

export async function updateCompany(actor: Actor, companyId: ObjectId, patch: Partial<CompanyInput> & { reminderOffsets?: number[] | null }) {
  const c = await cols();
  const before = await c.companies.findOne({ _id: companyId });
  if (!before) throw new NotFoundError("Company not found.");
  const set: Record<string, unknown> = { ...patch, updatedAt: new Date() };
  if (patch.name) {
    const nameLower = patch.name.trim().toLowerCase();
    if (await c.companies.findOne({ nameLower, _id: { $ne: companyId } })) throw new AppError("Another company already has this name.", "name");
    set.name = patch.name.trim();
    set.nameLower = nameLower;
  }
  const unset: Record<string, ""> = {};
  if (patch.reminderOffsets === null) {
    delete set.reminderOffsets;
    unset.reminderOffsets = "";
  }
  await c.companies.updateOne({ _id: companyId }, { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) });
  await audit(actor, "company.update", "company", companyId, before, { ...before, ...set });
}

/** Clients may edit only their billing address and billing emails. */
export async function updateBillingByClient(actor: Actor, companyId: ObjectId, input: { billingAddress: string; city: string; country: string; billingEmails: string[] }) {
  const c = await cols();
  const before = await c.companies.findOne({ _id: companyId });
  if (!before) throw new NotFoundError();
  await c.companies.updateOne({ _id: companyId }, { $set: { ...input, updatedAt: new Date() } });
  await audit(actor, "company.billing_update_by_client", "company", companyId,
    { billingAddress: before.billingAddress, city: before.city, country: before.country, billingEmails: before.billingEmails }, input);
}

/** Companies are archived, never deleted. */
export async function setCompanyArchived(actor: Actor, companyId: ObjectId, archived: boolean) {
  const c = await cols();
  await c.companies.updateOne({ _id: companyId }, { $set: { status: archived ? "archived" : "active", updatedAt: new Date() } });
  if (archived) await c.recurringPlans.updateMany({ companyId, status: "active" }, { $set: { status: "paused", updatedAt: new Date() } });
  await audit(actor, archived ? "company.archive" : "company.unarchive", "company", companyId);
}

export async function listCompanies(opts: { q?: string; status?: "active" | "archived" | "all" } = {}) {
  const c = await cols();
  const filter: Record<string, unknown> = {};
  if (opts.status && opts.status !== "all") filter.status = opts.status;
  if (opts.q) filter.nameLower = { $regex: escapeRegex(opts.q.trim().toLowerCase()) };
  return c.companies.find(filter).sort({ name: 1 }).limit(500).toArray();
}

export async function getCompany(id: ObjectId) {
  const c = await cols();
  return c.companies.findOne({ _id: id });
}

export async function companyContacts(companyId: ObjectId) {
  const c = await cols();
  const ms = await c.memberships.find({ companyId }).toArray();
  const users = await c.users.find({ _id: { $in: ms.map((m) => m.userId) } }).sort({ name: 1 }).toArray();
  return users.map((u) => ({ ...u, isPrimary: ms.find((m) => m.userId.equals(u._id))?.isPrimary ?? false }));
}

/** To + CC list for documents sent to a company. */
export async function companyRecipients(companyId: ObjectId) {
  const c = await cols();
  const company = await c.companies.findOne({ _id: companyId });
  const contacts = (await companyContacts(companyId)).filter((u) => u.status !== "deactivated");
  const primary = contacts.find((u) => u.isPrimary) ?? contacts[0];
  const to = contacts.map((u) => u.email);
  const cc = company?.billingEmails ?? [];
  return {
    to: to.length ? to : cc,
    cc: to.length ? cc : [],
    primaryName: primary?.name ?? company?.name ?? "there",
    primary,
  };
}

export { escapeRegex };
