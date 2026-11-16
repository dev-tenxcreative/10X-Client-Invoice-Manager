import { notFound } from "next/navigation";
import { ObjectId } from "mongodb";
import { Card, DL, Money, PageHeader, StatusBadge, buttonClass } from "@/components/ui";
import { ActionForm, Checkbox, Field, SubmitButton, TextArea } from "@/components/client/action-form";
import { DocFrame } from "@/components/client/doc-frame";
import { acceptProposalAction, declineProposalAction } from "@/app/actions/portal";
import { getPortalContext } from "@/lib/auth/session";
import { cols } from "@/lib/db";
import { canAccessCompany } from "@/lib/permissions";
import { markProposalViewed, proposalDocData } from "@/lib/services/proposals";
import { renderProposalHtml } from "@/lib/documents/proposal-html";
import { formatDate, formatDateTime, today } from "@/lib/dates";
import { formatMoney } from "@/lib/money";

export const metadata = { title: "Proposal" };

export default async function PortalProposal({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getPortalContext();
  if (!ObjectId.isValid(id)) notFound();
  const c = await cols();
  const p = await c.proposals.findOne({ _id: new ObjectId(id) });
  if (!p || p.status === "draft" || !canAccessCompany(ctx, p.companyId)) notFound();
  if (!ctx.readOnly) await markProposalViewed(p._id);
  const data = await proposalDocData(p);
  const html = p.source === "built" ? renderProposalHtml(data, "screen") : null;
  const canRespond = ["sent", "viewed"].includes(p.status) && p.content.validUntil >= today() && !ctx.readOnly;

  return (
    <>
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-3">{p.content.title} <StatusBadge status={p.status} /></span>}
        description={`${p.reference} · valid until ${formatDate(p.content.validUntil)}`}
        back={{ href: "/portal/proposals", label: "Proposals" }}
        actions={<a href={`/api/proposals/${id}/pdf`} className={buttonClass("secondary")}>Download PDF</a>}
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          {html ? <DocFrame html={html} title={`Proposal ${p.reference}`} /> : (
            <Card><p className="text-sm">This proposal is a PDF document.</p><a href={`/api/proposals/${id}/pdf`} className="mt-2 inline-block font-medium text-brand hover:underline">Download the proposal</a></Card>
          )}
        </div>
        <aside className="space-y-4">
          <Card title="Summary">
            <DL items={[["Total", <Money key="t" amount={p.total} currency={p.content.currency} />], ["Date", formatDate(p.content.date)], ["Valid until", formatDate(p.content.validUntil)]]} />
          </Card>
          {p.status === "accepted" && p.acceptance && (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">Accepted by {p.acceptance.name} ({p.acceptance.designation}) on {formatDateTime(p.acceptance.at)}. Thank you!</div>
          )}
          {p.status === "declined" && <div className="rounded-md border border-line bg-white px-4 py-3 text-sm">You declined this proposal on {formatDateTime(p.decline?.at)}.</div>}
          {p.status === "expired" && <div className="rounded-md border border-line bg-white px-4 py-3 text-sm">This proposal has expired. Please contact us for an updated one.</div>}
          {canRespond && (
            <>
              <Card title="Accept this proposal">
                <ActionForm action={acceptProposalAction} className="space-y-3"
                  confirm={{ title: "Accept this proposal?", summary: `You are accepting ${p.reference} for ${formatMoney(p.total, p.content.currency)} on behalf of ${ctx.company.name}. We will record your name, designation, the time and your IP address.`, confirmLabel: "Accept proposal" }}>
                  <input type="hidden" name="id" value={id} />
                  <Field name="name" label="Your full name" defaultValue={ctx.auth.user.name} required />
                  <Field name="designation" label="Your designation" defaultValue={ctx.auth.user.designation} required />
                  <Checkbox name="agree" label={<>I agree to this proposal and its terms on behalf of <strong>{ctx.company.name}</strong>.</>} />
                  <SubmitButton>Accept proposal</SubmitButton>
                </ActionForm>
              </Card>
              <Card title="Decline">
                <ActionForm action={declineProposalAction} className="space-y-3" confirm={{ title: "Decline this proposal?", summary: "We will let the 10X Creative team know." }}>
                  <input type="hidden" name="id" value={id} />
                  <TextArea name="reason" label="Reason (optional)" rows={3} />
                  <SubmitButton variant="secondary">Decline proposal</SubmitButton>
                </ActionForm>
              </Card>
            </>
          )}
        </aside>
      </div>
    </>
  );
}
