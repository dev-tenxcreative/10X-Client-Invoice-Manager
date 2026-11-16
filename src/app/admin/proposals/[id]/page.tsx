import Link from "next/link";
import { notFound } from "next/navigation";
import { ObjectId } from "mongodb";
import { Card, DL, LinkButton, Money, PageHeader, StatusBadge, buttonClass } from "@/components/ui";
import { ActionButton, ActionForm, Checkbox, Field, FileField, Select, SubmitButton } from "@/components/client/action-form";
import { DocFrame } from "@/components/client/doc-frame";
import { proposalAcceptManualAction, proposalInvoicesAction, proposalPlanAction, sendProposalAction } from "@/app/actions/admin";
import { cols } from "@/lib/db";
import { proposalDocData } from "@/lib/services/proposals";
import { renderProposalHtml } from "@/lib/documents/proposal-html";
import { formatDate, formatDateTime, today } from "@/lib/dates";
import { formatMoney, formatRate, splitByMilestones } from "@/lib/money";

export const metadata = { title: "Proposal" };

export default async function ProposalPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ v?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!ObjectId.isValid(id)) notFound();
  const c = await cols();
  const p = await c.proposals.findOne({ _id: new ObjectId(id) });
  if (!p) notFound();
  const data = await proposalDocData(p);
  const old = sp.v ? p.versions.find((v) => String(v.version) === sp.v) : null;
  const html = p.source === "built"
    ? renderProposalHtml(old ? { ...data, content: old.content, totals: old.totals, proposal: { ...p, version: old.version, acceptance: undefined } } : data, "screen")
    : null;
  const invoices = await c.invoices.find({ proposalId: p._id }).toArray();
  const t = today();
  const preTax = p.subtotal - p.discountTotal;
  const amounts = splitByMilestones(preTax, p.content.paymentSchedule);

  return (
    <>
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-3">{p.reference} <StatusBadge status={p.status} /></span>}
        description={<>{p.content.title} · for <Link href={`/admin/companies/${p.companyId}`} className="font-medium text-ink hover:text-brand">{data.company.name}</Link></>}
        back={{ href: "/admin/proposals", label: "Proposals" }}
        actions={
          <>
            <a href={`/api/proposals/${id}/pdf`} className={buttonClass("secondary")}>Download PDF</a>
            {p.source === "built" && !["accepted", "declined"].includes(p.status) && <LinkButton href={`/admin/proposals/${id}/edit`} variant="secondary">{p.status === "draft" ? "Edit" : "Edit (new version)"}</LinkButton>}
          </>
        }
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0">
          {old && <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">You are viewing version {old.version} (read-only). <Link href={`/admin/proposals/${id}`} className="font-medium underline">Back to the current version</Link></div>}
          {html ? <DocFrame html={html} title={`Proposal ${p.reference}`} /> : (
            <object data={`/api/proposals/${id}/pdf?inline=1`} type="application/pdf" className="h-[900px] w-full rounded border border-line bg-white">
              <a href={`/api/proposals/${id}/pdf`} className="text-brand underline">Download the PDF</a>
            </object>
          )}
        </div>
        <aside className="space-y-4">
          <Card title="Summary">
            <DL items={[
              ["Total", <Money key="t" amount={p.total} currency={p.content.currency} />],
              ["Date", formatDate(p.content.date)],
              ["Valid until", formatDate(p.content.validUntil)],
              ["Version", String(p.version)],
              ["Sent", p.sentAt ? formatDateTime(p.sentAt) : "Not yet"],
              ["Viewed", p.viewedAt ? formatDateTime(p.viewedAt) : ""],
              ["Accepted by", p.acceptance ? `${p.acceptance.name}, ${p.acceptance.designation} (${p.acceptance.method === "online" ? "online" : "signed copy"}) on ${formatDateTime(p.acceptance.at)}${p.acceptance.ip ? ` from ${p.acceptance.ip}` : ""}` : ""],
              ["Declined", p.decline ? `${formatDateTime(p.decline.at)}${p.decline.reason ? `: ${p.decline.reason}` : ""}` : ""],
              ["Signed copy", p.signedFileId ? <a key="s" href={`/api/files/${p.signedFileId}`} className="text-brand hover:underline">Download</a> : ""],
            ]} />
            {p.versions.length > 0 && (
              <div className="mt-4 text-sm">
                <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">Earlier versions</div>
                {p.versions.map((v) => <Link key={v.version} href={`/admin/proposals/${id}?v=${v.version}`} className="mr-3 text-brand hover:underline">Version {v.version}</Link>)}
              </div>
            )}
          </Card>

          {!["accepted", "declined"].includes(p.status) && (
            <Card title={p.status === "draft" ? "Send to client" : "Send again"}>
              {p.content.validUntil < t ? <p className="text-sm text-red-700">The valid-until date has passed. Edit the proposal to extend it first.</p> : (
                <ActionForm action={sendProposalAction} className="space-y-3" confirm={{ title: "Send this proposal?", summary: `${data.company.name}'s contacts will get an email with a link to view, accept or decline ${p.reference} (${formatMoney(p.total, p.content.currency)}).`, confirmLabel: "Send proposal" }}>
                  <input type="hidden" name="id" value={id} />
                  <Checkbox name="attachPdf" label="Attach the PDF to the email" defaultChecked />
                  <SubmitButton>{p.status === "draft" ? "Send proposal" : "Resend"}</SubmitButton>
                </ActionForm>
              )}
            </Card>
          )}

          {p.status !== "accepted" && p.status !== "draft" && (
            <Card title="Signed on paper?">
              <ActionForm action={proposalAcceptManualAction} className="space-y-3" confirm={{ title: "Mark as accepted?", summary: "Record that the client accepted this proposal outside the portal." }}>
                <input type="hidden" name="id" value={id} />
                <Field name="name" label="Signed by" />
                <Field name="designation" label="Designation" />
                <Field name="date" label="Date signed" type="date" defaultValue={t} />
                <FileField name="file" label="Signed copy (optional)" />
                <SubmitButton variant="secondary">Mark as accepted</SubmitButton>
              </ActionForm>
            </Card>
          )}

          {p.status === "accepted" && p.source === "built" && (
            <Card title="Next steps">
              {invoices.length > 0 ? (
                <div className="text-sm">
                  <p className="mb-2 text-muted">Invoices created from this proposal:</p>
                  <ul className="space-y-1">{invoices.map((i) => <li key={i._id.toHexString()}><Link href={`/admin/invoices/${i._id}`} className="text-brand hover:underline">{i.number}</Link> · <Money amount={i.total} currency={i.currency} /> · <StatusBadge status={i.status} /></li>)}</ul>
                </div>
              ) : p.content.paymentSchedule.length > 0 ? (
                <div>
                  <p className="mb-2 text-sm text-muted">One draft invoice per milestone (amounts before tax; each invoice adds {p.content.tax.rateBp ? `${p.content.tax.label} ${formatRate(p.content.tax.rateBp)}` : "no tax"}):</p>
                  <ul className="mb-3 space-y-1 text-sm">{p.content.paymentSchedule.map((m, i) => <li key={i}>{m.label}: <strong>{formatMoney(amounts[i], p.content.currency)}</strong></li>)}</ul>
                  <ActionButton action={proposalInvoicesAction} fields={{ id }} variant="primary" confirm={{ title: "Create invoices from the payment schedule?", summary: `${p.content.paymentSchedule.length} draft invoice(s) will be created for ${data.company.name}. You can review them before sending.` }}>Create invoices from payment schedule</ActionButton>
                </div>
              ) : <p className="text-sm text-muted">This proposal has no payment schedule.</p>}
              <div className="mt-5 border-t border-line pt-4">
                {p.planId ? <Link href={`/admin/plans/${p.planId}`} className="text-sm text-brand hover:underline">Open the recurring plan</Link> : (
                  <ActionForm action={proposalPlanAction} className="space-y-3">
                    <p className="text-sm font-medium">Monthly retainer? Create a recurring plan</p>
                    <input type="hidden" name="id" value={id} />
                    <div className="grid grid-cols-2 gap-3">
                      <Field name="startDate" label="Start date" type="date" defaultValue={t} />
                      <Field name="billingDay" label="Billing day" type="number" min={1} max={28} defaultValue={1} />
                      <Field name="dueAfterDays" label="Due after (days)" type="number" defaultValue={data.company.paymentTermsDays} />
                      <Select name="mode" label="Mode" options={[{ value: "review", label: "Draft for review" }, { value: "auto", label: "Send automatically" }]} />
                    </div>
                    <SubmitButton variant="secondary">Create recurring plan</SubmitButton>
                  </ActionForm>
                )}
              </div>
            </Card>
          )}
        </aside>
      </div>
    </>
  );
}
