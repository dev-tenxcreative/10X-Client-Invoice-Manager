/**
 * Seed: indexes, settings, the super admin (with activation email) and demo data.
 *   npm run seed              -> everything
 *   npm run seed -- --no-demo -> no demo data
 * Demo data is marked isDemo and removed with `npm run seed:remove-demo`.
 */
import "./load-env";
import { ObjectId } from "mongodb";
import { cols, getClient } from "../src/lib/db";
import { ensureIndexes } from "../src/lib/indexes";
import { appUrl, superAdminEmail } from "../src/lib/env";
import { ensureSettings, getSettings } from "../src/lib/services/settings";
import { createActivationToken, sendActivationEmail } from "../src/lib/services/users";
import { createClient } from "../src/lib/services/companies";
import { createGeneratedInvoice, sendInvoice } from "../src/lib/services/invoices";
import { recordPayment } from "../src/lib/services/payments";
import { createBuiltProposal } from "../src/lib/services/proposals";
import { addDays, today } from "../src/lib/dates";
import { computeTotals, normaliseItems } from "../src/lib/money";
import type { Actor } from "../src/lib/services/audit";
import type { UserDoc } from "../src/lib/types";

async function main() {
  const c = await cols();
  console.log("• Creating indexes…");
  await ensureIndexes(c);
  console.log("• Settings…");
  await ensureSettings();

  const email = superAdminEmail();
  let admin = await c.users.findOne({ email });
  if (!admin) {
    const now = new Date();
    admin = { _id: new ObjectId(), email, name: "10X Creative Admin", role: "super_admin", status: "invited", createdAt: now, updatedAt: now } satisfies UserDoc;
    await c.users.insertOne(admin);
    console.log(`• Super admin created: ${email}`);
  } else if (admin.role !== "super_admin") {
    await c.users.updateOne({ _id: admin._id }, { $set: { role: "super_admin" } });
  }
  if (admin.status === "invited") {
    const token = await createActivationToken(admin._id);
    const log = await sendActivationEmail(admin, token);
    console.log(`• Activation email to ${email}: ${log.status}${log.error ? ` (${log.error})` : ""}`);
    console.log(`  Activation link (valid 72 hours, single use):\n  ${appUrl(`/activate/${token}`)}`);
  } else {
    console.log(`• Super admin ${email} is already ${admin.status}.`);
  }

  if (process.argv.includes("--no-demo")) return;
  if (await c.companies.findOne({ isDemo: true })) {
    console.log("• Demo data already present (remove it with npm run seed:remove-demo).");
    return;
  }
  console.log("• Demo data…");
  const actor: Actor = { userId: admin._id, email: admin.email, role: "super_admin", name: admin.name };
  const t = today();
  const settings = await getSettings();

  const a = await createClient(actor, {
    contact: { name: "Nimal Perera", email: "nimal.perera@demo-lanka-foods.example", phone: "+94 77 000 0001", designation: "Marketing Manager" },
    company: { name: "Demo: Lanka Foods (Pvt) Ltd", billingAddress: "45 Galle Road", city: "Colombo 03", country: "Sri Lanka", billingEmails: [], currency: "LKR", paymentTermsDays: 14 },
    sendInvite: false,
    isDemo: true,
  });
  const b = await createClient(actor, {
    contact: { name: "Sarah Fernando", email: "sarah@demo-ceylon-travel.example", designation: "Director" },
    company: { name: "Demo: Ceylon Travel Co", billingAddress: "12 Temple Road", city: "Kandy", country: "Sri Lanka", billingEmails: [], currency: "USD", paymentTermsDays: 7 },
    sendInvite: false,
    isDemo: true,
  });

  const inv1 = await createGeneratedInvoice(actor, {
    companyId: a.company._id, issueDate: addDays(t, -20), dueDate: addDays(t, -6), currency: "LKR",
    items: [{ title: "Full social media package (monthly retainer)", detail: "Strategy, content creation, reels, community management\nMonthly ad campaign setup and reporting", qty100: 100, unitPrice: 25000000, period: "October 2026" }],
    discount: { type: "none", value: 0 }, tax: { label: "VAT", rateBp: 0 }, billingPeriod: "October 2026", remindersEnabled: true,
  }, { isDemo: true });
  await sendInvoice(actor, inv1._id, { email: false });

  const inv2 = await createGeneratedInvoice(actor, {
    companyId: a.company._id, issueDate: addDays(t, -2), dueDate: addDays(t, 12), currency: "LKR",
    items: [
      { title: "Landing page optimisation", detail: "Speed, layout and conversion improvements", qty100: 100, unitPrice: 6000000 },
      { title: "Pixel and analytics setup", qty100: 150, unitPrice: 2000000 },
    ],
    discount: { type: "percent", value: 500 }, tax: { label: "VAT", rateBp: 0 }, remindersEnabled: true,
  }, { isDemo: true });
  await sendInvoice(actor, inv2._id, { email: false });
  await recordPayment(actor, { invoiceId: inv2._id, date: t, amount: 4000000, method: "bank_transfer", reference: "DEMO-TT-001" }, { notify: false });

  const inv3 = await createGeneratedInvoice(actor, {
    companyId: b.company._id, issueDate: addDays(t, -10), dueDate: addDays(t, -3), currency: "USD",
    items: [{ title: "Website maintenance", detail: "Monthly updates and backups", qty100: 100, unitPrice: 30000, period: "November 2026" }],
    discount: { type: "none", value: 0 }, tax: { label: "VAT", rateBp: 0 }, remindersEnabled: true,
  }, { isDemo: true });
  await sendInvoice(actor, inv3._id, { email: false });
  await recordPayment(actor, { invoiceId: inv3._id, date: addDays(t, -1), amount: 30000, method: "online", reference: "DEMO-CARD" }, { notify: false });

  const prop = await createBuiltProposal(actor, { companyId: b.company._id, template: "web", title: "Website redesign", isDemo: true });
  const investment = normaliseItems([
    { title: "Discovery and UX", detail: "Workshops, sitemap and wireframes", qty100: 100, unitPrice: 50000 },
    { title: "Design and development", detail: "Responsive pages, CMS and forms", qty100: 100, unitPrice: 180000 },
    { title: "Launch and training", detail: "Deployment, testing and handover", qty100: 100, unitPrice: 30000 },
  ]);
  const totals = computeTotals(investment, { type: "none", value: 0 }, settings.tax);
  await c.proposals.updateOne({ _id: prop._id }, { $set: { "content.investment": investment, "content.currency": "USD", ...totals, status: "sent", sentAt: new Date() } });

  console.log(`  Companies: ${a.company.name}, ${b.company.name}`);
  console.log(`  Invoices: ${inv1.number} (overdue), ${inv2.number} (partly paid), ${inv3.number} (paid)`);
  console.log(`  Proposal: ${prop.reference} (sent)`);
  console.log("  Demo contacts use .example emails and were not invited.");
}

main()
  .then(async () => {
    console.log("Done.");
    await (await getClient()).close();
  })
  .catch(async (e) => {
    console.error(e);
    await (await getClient()).close().catch(() => {});
    process.exit(1);
  });
