/**
 * Service-level tests against a real MongoDB replica set (mongodb-memory-server), covering
 * the money, access-control and idempotency rules from the acceptance checklist.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { ObjectId } from "mongodb";
import type { Actor } from "@/lib/services/audit";

let rs: MongoMemoryReplSet;
let actor: Actor;
// Loaded after the database URI is set.
let svc: {
  db: typeof import("@/lib/db");
  idx: typeof import("@/lib/indexes");
  settings: typeof import("@/lib/services/settings");
  users: typeof import("@/lib/services/users");
  companies: typeof import("@/lib/services/companies");
  invoices: typeof import("@/lib/services/invoices");
  payments: typeof import("@/lib/services/payments");
  plans: typeof import("@/lib/services/plans");
  reminders: typeof import("@/lib/services/reminders");
  dates: typeof import("@/lib/dates");
};

beforeAll(async () => {
  rs = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  process.env.MONGODB_URI = rs.getUri();
  process.env.MONGODB_DB = "tenx_test";
  process.env.EMAIL_PROVIDER = "console";
  process.env.APP_URL = "http://localhost:3000";
  process.env.SUPER_ADMIN_EMAIL = "dev@tenxcreative.com";
  svc = {
    db: await import("@/lib/db"),
    idx: await import("@/lib/indexes"),
    settings: await import("@/lib/services/settings"),
    users: await import("@/lib/services/users"),
    companies: await import("@/lib/services/companies"),
    invoices: await import("@/lib/services/invoices"),
    payments: await import("@/lib/services/payments"),
    plans: await import("@/lib/services/plans"),
    reminders: await import("@/lib/services/reminders"),
    dates: await import("@/lib/dates"),
  };
  const c = await svc.db.cols();
  await svc.idx.ensureIndexes(c);
  await svc.settings.ensureSettings();
  const now = new Date();
  const superId = new ObjectId();
  await c.users.insertOne({ _id: superId, email: "dev@tenxcreative.com", name: "Super", role: "super_admin", status: "active", createdAt: now, updatedAt: now });
  actor = { userId: superId, email: "dev@tenxcreative.com", role: "super_admin", name: "Super" };
}, 180000);

afterAll(async () => {
  await (await svc?.db.getClient())?.close().catch(() => {});
  await rs?.stop();
});

async function newClient(name: string, email: string) {
  return svc.companies.createClient(actor, {
    contact: { name: "Contact " + name, email },
    company: { name, billingAddress: "1 Main St", city: "Colombo", country: "Sri Lanka", billingEmails: [], currency: "LKR", paymentTermsDays: 14 },
    sendInvite: true,
  });
}

describe("clients and access", () => {
  it("creates company, user, membership and invitation together", async () => {
    const res = await newClient("Alpha Ltd", "a@alpha.test");
    const c = await svc.db.cols();
    expect(await c.memberships.countDocuments({ companyId: res.company._id, userId: res.user._id })).toBe(1);
    expect(await c.authTokens.countDocuments({ userId: res.user._id, type: "activation" })).toBe(1);
    expect(res.user.status).toBe("invited");
  });

  it("rolls back everything when part of the save fails", async () => {
    const c = await svc.db.cols();
    const before = await c.companies.countDocuments();
    await c.users.insertOne({ _id: new ObjectId(), email: "taken@beta.test", name: "x", role: "client", status: "active", createdAt: new Date(), updatedAt: new Date() });
    await expect(newClient("Beta Ltd", "taken@beta.test")).rejects.toThrow(/already exists/);
    expect(await c.companies.countDocuments()).toBe(before);
    expect(await c.companies.findOne({ nameLower: "beta ltd" })).toBeNull();
  });

  it("client A cannot open client B's invoice", async () => {
    const a = await newClient("Gamma Ltd", "g@gamma.test");
    const b = await newClient("Delta Ltd", "d@delta.test");
    const t = svc.dates.today();
    const invB = await svc.invoices.createGeneratedInvoice(actor, {
      companyId: b.company._id, issueDate: t, dueDate: svc.dates.addDays(t, 7), currency: "LKR",
      items: [{ title: "Work", qty100: 100, unitPrice: 100000 }], discount: { type: "none", value: 0 }, tax: { label: "VAT", rateBp: 0 }, remindersEnabled: true,
    });
    await svc.invoices.sendInvoice(actor, invB._id, { email: false });
    const fresh = await svc.invoices.getInvoice(invB._id);
    expect(() => svc.invoices.assertInvoiceAccess(fresh, [a.company._id])).toThrow();
    expect(() => svc.invoices.assertInvoiceAccess(fresh, [b.company._id])).not.toThrow();
    // Slip upload against another company's invoice is refused.
    const clientActor: Actor = { userId: a.user._id, email: a.user.email, role: "client", name: a.user.name };
    await expect(svc.payments.submitSlip(clientActor, [a.company._id], { invoiceId: invB._id, amount: 100, date: t, file: { bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]), name: "x.pdf" } })).rejects.toThrow(/access/);
  });

  it("an email no admin created cannot get an account", async () => {
    await svc.users.requestFirstTimeLink("stranger@nowhere.test", "1.2.3.4");
    const c = await svc.db.cols();
    expect(await c.users.findOne({ email: "stranger@nowhere.test" })).toBeNull();
    expect(await c.emailLogs.countDocuments({ to: "stranger@nowhere.test" })).toBe(0);
  });
});

describe("super admin protection", () => {
  it("cannot be deactivated, removed, demoted or renamed", async () => {
    const c = await svc.db.cols();
    const sup = (await c.users.findOne({ email: "dev@tenxcreative.com" }))!;
    await expect(svc.users.setUserStatus(actor, sup._id, "deactivated")).rejects.toThrow(/super admin/);
    await expect(svc.users.removeAdmin(actor, sup._id)).rejects.toThrow(/super admin/);
    await expect(svc.users.changeRole(actor, sup._id, "admin")).rejects.toThrow(/super admin/);
    await expect(svc.users.changeEmail(actor, sup._id, "x@y.test")).rejects.toThrow(/cannot be changed/);
  });
  it("a removed admin can be invited again with the same email", async () => {
    const c = await svc.db.cols();
    const invited = await svc.users.inviteAdmin(actor, { name: "Re Admin", email: "Re.Admin@x.test" });
    await c.users.updateOne({ _id: invited._id }, { $set: { status: "active", passwordHash: "old-hash" } });
    // Deleting an admin removes them from the database, with their sessions and links.
    const other = await svc.users.inviteAdmin(actor, { name: "Gone Admin", email: "gone@x.test" });
    await svc.users.removeAdmin(actor, other._id);
    expect(await c.users.findOne({ _id: other._id })).toBeNull();
    expect(await c.authTokens.countDocuments({ userId: other._id })).toBe(0);
    const again = await svc.users.inviteAdmin(actor, { name: "Gone Admin", email: "gone@x.test" });
    expect(again._id.equals(other._id)).toBe(false);
    // Legacy records (removed before admins were deleted) are found through the audit log.
    await c.users.updateOne({ _id: invited._id }, { $set: { status: "deactivated", role: "client" } });
    await c.auditLogs.insertOne({ _id: new ObjectId(), action: "admin.remove", entityType: "user", entityId: invited._id, at: new Date() });
    expect((await svc.users.listRemovedAdmins()).map((u) => u.email)).toContain("re.admin@x.test");

    const back = await svc.users.inviteAdmin(actor, { name: "Re Admin 2", email: "re.admin@x.test" });
    expect(back._id.equals(invited._id)).toBe(true);
    const fresh = (await c.users.findOne({ _id: invited._id }))!;
    expect(fresh).toMatchObject({ role: "admin", status: "invited", name: "Re Admin 2" });
    expect(fresh.passwordHash).toBeUndefined();
    expect(await c.authTokens.countDocuments({ userId: invited._id, type: "activation", usedAt: { $exists: false } })).toBe(1);
    expect((await svc.users.listRemovedAdmins()).map((u) => u.email)).not.toContain("re.admin@x.test");
    // Active admin, and a client contact's email, are refused with a clear message.
    await c.users.updateOne({ _id: invited._id }, { $set: { status: "active" } });
    await expect(svc.users.inviteAdmin(actor, { name: "X", email: "re.admin@x.test" })).rejects.toThrow(/already an admin/);
    const client = await newClient("Restore Co", "contact@restore.test");
    await expect(svc.users.inviteAdmin(actor, { name: "X", email: client.user.email })).rejects.toThrow(/client contact/);
  });
  it("a normal admin cannot manage admins", async () => {
    const admin: Actor = { userId: new ObjectId(), email: "admin@x.test", role: "admin", name: "A" };
    await expect(svc.users.inviteAdmin(admin, { name: "B", email: "b@x.test" })).rejects.toThrow(/super admin/);
  });
});

describe("payments", () => {
  it("allows partial payments, blocks overpayment and marks paid", async () => {
    const co = await newClient("Epsilon Ltd", "e@eps.test");
    const t = svc.dates.today();
    const inv = await svc.invoices.createGeneratedInvoice(actor, {
      companyId: co.company._id, issueDate: t, dueDate: t, currency: "LKR",
      items: [{ title: "Retainer", qty100: 100, unitPrice: 6500000 }], discount: { type: "none", value: 0 }, tax: { label: "VAT", rateBp: 0 }, remindersEnabled: true,
    });
    await svc.invoices.sendInvoice(actor, inv._id, { email: false });
    const r1 = await svc.payments.recordPayment(actor, { invoiceId: inv._id, date: t, amount: 2500000, method: "cash" }, { notify: false });
    expect(r1.invoice.status).toBe("partially_paid");
    expect(r1.invoice.balance).toBe(4000000);
    await expect(svc.payments.recordPayment(actor, { invoiceId: inv._id, date: t, amount: 4000001, method: "cash" }, { notify: false })).rejects.toThrow(/more than the balance/);
    const r2 = await svc.payments.recordPayment(actor, { invoiceId: inv._id, date: t, amount: 4000000, method: "cash" }, { notify: false });
    expect(r2.invoice.status).toBe("paid");
    expect(r2.invoice.balance).toBe(0);
  });
  it("locks sent invoices", async () => {
    const co = await newClient("Zeta Ltd", "z@zeta.test");
    const t = svc.dates.today();
    const input = { companyId: co.company._id, issueDate: t, dueDate: t, currency: "LKR" as const, items: [{ title: "X", qty100: 100, unitPrice: 100 }], discount: { type: "none" as const, value: 0 }, tax: { label: "VAT", rateBp: 0 }, remindersEnabled: true };
    const inv = await svc.invoices.createGeneratedInvoice(actor, input);
    await svc.invoices.sendInvoice(actor, inv._id, { email: false });
    await expect(svc.invoices.updateDraftInvoice(actor, inv._id, input)).rejects.toThrow(/Only drafts/);
  });
});

describe("recurring plans and reminders", () => {
  it("creates exactly one invoice per month even when the job runs twice", async () => {
    const co = await newClient("Eta Ltd", "h@eta.test");
    const t = svc.dates.today();
    const plan = await svc.plans.createPlan(actor, {
      companyId: co.company._id, name: "Social retainer", items: [{ title: "Social media", qty100: 100, unitPrice: 25000000 }], currency: "LKR",
      discount: { type: "none", value: 0 }, tax: { label: "VAT", rateBp: 0 }, startDate: `${t.slice(0, 7)}-01`, billingDay: 1, dueAfterDays: 14, mode: "review",
    });
    const run1 = await svc.plans.runRecurringPlans(t);
    const run2 = await svc.plans.runRecurringPlans(t);
    const c = await svc.db.cols();
    const invs = await c.invoices.find({ planId: plan._id }).toArray();
    expect(invs.length).toBe(1);
    expect(invs[0].status).toBe("draft"); // review mode
    expect(invs[0].billingPeriod).toBe(svc.dates.periodLabel(t.slice(0, 7)));
    expect(run1.created + run2.created).toBe(1);
    // Even a direct duplicate insert is blocked by the unique index.
    await expect(svc.plans.generatePlanInvoice(plan, t.slice(0, 7))).resolves.toBeNull();
  });

  it("sends each reminder step once and stops after payment", async () => {
    const co = await newClient("Theta Ltd", "t@theta.test");
    const t = svc.dates.today();
    const inv = await svc.invoices.createGeneratedInvoice(actor, {
      companyId: co.company._id, issueDate: svc.dates.addDays(t, -10), dueDate: svc.dates.addDays(t, -3), currency: "LKR",
      items: [{ title: "Work", qty100: 100, unitPrice: 100000 }], discount: { type: "none", value: 0 }, tax: { label: "VAT", rateBp: 0 }, remindersEnabled: true,
    });
    await svc.invoices.sendInvoice(actor, inv._id, { email: false });
    const c = await svc.db.cols();
    await c.invoices.updateOne({ _id: inv._id }, { $set: { sentAt: new Date(Date.now() - 10 * 86400000) } });
    await svc.reminders.runReminders(t);
    await svc.reminders.runReminders(t);
    expect(await c.reminderLogs.countDocuments({ invoiceId: inv._id })).toBe(1);
    expect((await c.reminderLogs.findOne({ invoiceId: inv._id }))!.step).toBe(3);
    await svc.payments.recordPayment(actor, { invoiceId: inv._id, date: t, amount: 100000, method: "cash" }, { notify: false });
    await svc.reminders.runReminders(svc.dates.addDays(t, 4));
    expect(await c.reminderLogs.countDocuments({ invoiceId: inv._id })).toBe(1);
  });
});
