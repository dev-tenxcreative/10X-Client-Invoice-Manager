import { EmptyState, LinkButton, PageHeader, Tabs } from "@/components/ui";
import { ProposalTable } from "@/components/tables";
import { cols } from "@/lib/db";
import { t } from "@/lib/i18n";
import type { ProposalStatus } from "@/lib/types";

export const metadata = { title: "Proposals" };

const STATUSES: (ProposalStatus | "all")[] = ["all", "draft", "sent", "viewed", "accepted", "declined", "expired"];

export default async function ProposalsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const sp = await searchParams;
  const status = (STATUSES.includes(sp.status as ProposalStatus) ? sp.status : "all") as ProposalStatus | "all";
  const c = await cols();
  const proposals = await c.proposals.find(status === "all" ? {} : { status }).sort({ createdAt: -1 }).limit(300).toArray();
  const companies = await c.companies.find({ _id: { $in: proposals.map((p) => p.companyId) } }, { projection: { name: 1 } }).toArray();
  const names = new Map(companies.map((co) => [co._id.toHexString(), co.name]));
  return (
    <>
      <PageHeader title="Proposals" actions={<LinkButton href="/admin/proposals/new">New proposal</LinkButton>} />
      <Tabs current={status} tabs={STATUSES.map((s) => ({ key: s, label: s === "all" ? "All" : s[0].toUpperCase() + s.slice(1), href: s === "all" ? "/admin/proposals" : `/admin/proposals?status=${s}` }))} />
      {proposals.length === 0 ? <EmptyState title="No proposals here" text={t.empty.proposals} action={<LinkButton href="/admin/proposals/new">New proposal</LinkButton>} /> : <ProposalTable proposals={proposals} hrefBase="/admin/proposals" companyNames={names} />}
    </>
  );
}
