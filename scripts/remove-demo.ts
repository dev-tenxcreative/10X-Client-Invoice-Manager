/** Removes everything the seed script marked as demo data (isDemo: true) and records linked to it. */
import "./load-env";
import { cols, getClient } from "../src/lib/db";

async function main() {
  const c = await cols();
  const companies = await c.companies.find({ isDemo: true }).toArray();
  const companyIds = companies.map((x) => x._id);
  const users = await c.users.find({ isDemo: true }).toArray();
  const userIds = users.map((u) => u._id);
  const invoiceIds = (await c.invoices.find({ companyId: { $in: companyIds } }).toArray()).map((i) => i._id);

  const results = await Promise.all([
    c.payments.deleteMany({ companyId: { $in: companyIds } }),
    c.paymentSubmissions.deleteMany({ companyId: { $in: companyIds } }),
    c.reminderLogs.deleteMany({ invoiceId: { $in: invoiceIds } }),
    c.invoices.deleteMany({ companyId: { $in: companyIds } }),
    c.proposals.deleteMany({ companyId: { $in: companyIds } }),
    c.recurringPlans.deleteMany({ companyId: { $in: companyIds } }),
    c.files.deleteMany({ companyId: { $in: companyIds } }),
    c.memberships.deleteMany({ $or: [{ companyId: { $in: companyIds } }, { userId: { $in: userIds } }] }),
    c.sessions.deleteMany({ userId: { $in: userIds } }),
    c.authTokens.deleteMany({ userId: { $in: userIds } }),
    c.users.deleteMany({ _id: { $in: userIds } }),
    c.companies.deleteMany({ _id: { $in: companyIds } }),
  ]);
  const names = ["payments", "slips", "reminders", "invoices", "proposals", "plans", "files", "memberships", "sessions", "tokens", "users", "companies"];
  console.log("Removed demo data:", Object.fromEntries(results.map((r, i) => [names[i], r.deletedCount])));
  console.log("Note: R2 objects for demo PDFs are orphaned; they are private and harmless. Audit log entries are kept.");
}

main()
  .then(async () => (await getClient()).close())
  .catch(async (e) => {
    console.error(e);
    process.exit(1);
  });
