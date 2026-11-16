import { notFound, redirect } from "next/navigation";
import { ObjectId } from "mongodb";
import { PageHeader } from "@/components/ui";
import { ProposalBuilder } from "@/components/client/proposal-builder";
import { saveProposalAction } from "@/app/actions/admin";
import { cols } from "@/lib/db";
import { getSettings } from "@/lib/services/settings";
import { companyRecipients } from "@/lib/services/companies";
import { formatQty, formatRate, minorToInput } from "@/lib/money";
import type { CompanyDoc, SettingsDoc } from "@/lib/types";

export const metadata = { title: "Edit proposal" };

export default async function EditProposalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!ObjectId.isValid(id)) notFound();
  const c = await cols();
  const p = await c.proposals.findOne({ _id: new ObjectId(id) });
  if (!p) notFound();
  if (p.source !== "built" || p.status === "accepted" || p.status === "declined") redirect(`/admin/proposals/${id}`);
  const [company, settings, textBlocks, r] = await Promise.all([
    c.companies.findOne({ _id: p.companyId }),
    getSettings(),
    c.textBlocks.find().sort({ category: 1, title: 1 }).toArray(),
    companyRecipients(p.companyId),
  ]);
  if (!company) notFound();
  const cur = p.content.currency;
  // Plain, serialisable subsets for the client-side live preview.
  const companyLite = { name: company.name, billingAddress: company.billingAddress, city: company.city, country: company.country } as unknown as CompanyDoc;
  const settingsLite = { legalName: settings.legalName, signatoryName: settings.signatoryName, signatoryTitle: settings.signatoryTitle, address: settings.address, phone: settings.phone, website: settings.website } as unknown as SettingsDoc;

  return (
    <>
      <PageHeader title={`${p.reference}: ${p.content.title}`} description={`For ${company.name}${p.status !== "draft" ? `. This proposal was ${p.status}; saving creates version ${p.version + 1}.` : ""}`} back={{ href: `/admin/proposals/${id}`, label: "Back to proposal" }} />
      <ProposalBuilder
        id={id}
        reference={p.reference}
        status={p.status}
        save={saveProposalAction}
        textBlocks={textBlocks.map((b) => ({ id: b._id.toHexString(), title: `${b.category}: ${b.title}`, body: b.body }))}
        preview={{ company: companyLite, settings: settingsLite, contactName: r.primary?.name, proposal: { status: p.status, version: p.version } }}
        initial={{
          title: p.content.title,
          projectTitle: p.content.projectTitle,
          date: p.content.date,
          validUntil: p.content.validUntil,
          currency: cur,
          sections: p.content.sections,
          investment: p.content.investment.map((i) => ({ title: i.title, detail: i.detail ?? "", qty: formatQty(i.qty100), unitPrice: i.unitPrice ? minorToInput(i.unitPrice, cur) : "", period: "" })),
          investmentNotes: p.content.investmentNotes ?? "",
          discountType: p.content.discount.type,
          discountValue: p.content.discount.type === "percent" ? formatRate(p.content.discount.value).replace("%", "") : p.content.discount.type === "amount" ? minorToInput(p.content.discount.value, cur) : "",
          taxLabel: p.content.tax.label,
          taxRate: formatRate(p.content.tax.rateBp).replace("%", ""),
          timeline: p.content.timeline.map((r) => ({ phase: r.phase, duration: r.duration, notes: r.notes ?? "" })),
          paymentSchedule: p.content.paymentSchedule.map((m) => ({ label: m.label, type: m.type, value: m.type === "percent" ? formatRate(m.value).replace("%", "") : minorToInput(m.value, cur), dueNote: m.dueNote ?? "" })),
        }}
      />
    </>
  );
}
