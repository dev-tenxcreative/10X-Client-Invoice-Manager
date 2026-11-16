import { EmptyState, PageHeader } from "@/components/ui";
import { ProposalTable } from "@/components/tables";
import { getPortalContext } from "@/lib/auth/session";
import { cols } from "@/lib/db";
import { t } from "@/lib/i18n";

export const metadata = { title: "Proposals" };

export default async function PortalProposals() {
  const ctx = await getPortalContext();
  const c = await cols();
  const proposals = await c.proposals.find({ companyId: ctx.company._id, status: { $ne: "draft" } }).sort({ createdAt: -1 }).toArray();
  return (
    <>
      <PageHeader title="Proposals" description={ctx.company.name} />
      {proposals.length === 0 ? <EmptyState title="No proposals yet" text={t.client.noProposals} /> : <ProposalTable proposals={proposals} hrefBase="/portal/proposals" />}
    </>
  );
}
