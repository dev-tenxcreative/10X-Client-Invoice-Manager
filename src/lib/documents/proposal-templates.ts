import type { LineItem, Milestone, ProposalSection, TimelineRow } from "../types";

export const SECTION_ORDER: { key: string; title: string }[] = [
  { key: "executive_summary", title: "Executive summary" },
  { key: "requirements", title: "Understanding of your requirements" },
  { key: "scope", title: "Scope of work" },
  { key: "deliverables", title: "Deliverables" },
  { key: "exclusions", title: "Exclusions and assumptions" },
  { key: "timeline", title: "Timeline and milestones" },
  { key: "investment", title: "Investment" },
  { key: "payment_schedule", title: "Payment schedule" },
  { key: "terms", title: "Terms and conditions" },
  { key: "acceptance", title: "Acceptance" },
];

/** Sections whose content is mainly a table; their body is an optional introduction. */
export const TABLE_SECTIONS = new Set(["timeline", "investment", "payment_schedule"]);

/*
 * DRAFT WORDING: the default terms below are a starting point only. 10X Creative should review
 * them with a lawyer before use. They are editable in Settings → Text blocks and per proposal.
 */
export const DEFAULT_TERMS = `**Draft for review: 10X Creative should review these terms with a lawyer before use.**

1. **Scope changes.** Work not described in the Scope of work is a change. We will confirm the cost and time of any change in writing before starting it.
2. **Client responsibilities.** The client will provide content, brand assets, access and feedback on time. Delays in these may move the timeline.
3. **Approvals.** Each milestone is approved in writing (email is enough). Work approved is not reworked without a change request.
4. **Ownership.** Ownership of the final deliverables transfers to the client when all invoices for this proposal are paid in full. Until then, 10X Creative keeps ownership. Third-party items (fonts, plugins, stock media, hosting) remain under their own licences.
5. **Payment.** Invoices are payable by the due date shown on each invoice. Work may pause while invoices are overdue.
6. **Confidentiality.** Both parties keep the other's confidential information private and use it only for this project.
7. **Cancellation.** Either party may cancel with 14 days' written notice. The client pays for work completed up to the cancellation date. Advance payments cover work already started and are not refundable.
8. **Warranty and support.** We fix defects reported within 30 days of launch at no cost. Later changes are quoted separately.
9. **Validity.** This proposal is valid until the date shown on the cover. Prices may change after that date.
10. **Governing law.** This agreement is governed by the laws of Sri Lanka, and the courts of Colombo have jurisdiction.`;

const ACCEPTANCE_TEXT = "By signing below, both parties agree to the scope, investment, payment schedule and terms set out in this proposal.";

interface TemplateDef {
  label: string;
  projectTitle: string;
  sections: Record<string, string>;
  investment: Omit<LineItem, "amount">[];
  investmentNotes?: string;
  timeline: TimelineRow[];
  paymentSchedule: Milestone[];
}

export const PROPOSAL_TEMPLATES: Record<string, TemplateDef> = {
  web: {
    label: "Web and Software",
    projectTitle: "Website design and development",
    sections: {
      executive_summary: "10X Creative will design and build a fast, secure and easy-to-manage website that presents your business clearly and turns visitors into enquiries.",
      requirements: "From our discussions, we understand that you need:\n- A modern website that reflects your brand\n- Pages that are easy for your team to update\n- Good performance on mobile and search engines\n- Enquiry forms that reach the right people",
      scope: "- Discovery and sitemap\n- Visual design for key page layouts\n- Development and content entry\n- On-page SEO basics and analytics setup\n- Testing on major browsers and devices\n- Launch and handover training",
      deliverables: "- Responsive website, deployed to your hosting\n- Admin access and a short user guide\n- Analytics and search console setup\n- 30 days of post-launch defect fixes",
      exclusions: "- Copywriting and photography unless listed in the investment table\n- Domain, hosting and paid third-party licences\n- Ongoing maintenance after the warranty period",
      timeline: "",
      investment: "",
      payment_schedule: "",
      terms: DEFAULT_TERMS,
      acceptance: ACCEPTANCE_TEXT,
    },
    investment: [
      { title: "Discovery and UX", detail: "Workshops, sitemap and wireframes", qty100: 100, unitPrice: 0 },
      { title: "Design and development", detail: "Responsive pages, CMS and forms", qty100: 100, unitPrice: 0 },
      { title: "Launch and training", detail: "Deployment, testing and handover", qty100: 100, unitPrice: 0 },
    ],
    investmentNotes: "Hosting and domain renewals are billed separately.",
    timeline: [
      { phase: "Discovery and sitemap", duration: "1 week" },
      { phase: "Design", duration: "2 weeks" },
      { phase: "Development", duration: "3 weeks" },
      { phase: "Testing and launch", duration: "1 week" },
    ],
    paymentSchedule: [
      { label: "Advance on acceptance", type: "percent", value: 5000 },
      { label: "Before launch", type: "percent", value: 5000 },
    ],
  },
  social: {
    label: "Social Media Marketing",
    projectTitle: "Social media management retainer",
    sections: {
      executive_summary: "10X Creative will plan, create and manage your social media each month so your brand stays visible, consistent and growing.",
      requirements: "We understand that you want:\n- A steady, on-brand presence on your chosen platforms\n- Content that drives engagement and enquiries\n- Paid campaigns that are measured and improved each month",
      scope: "- Monthly content strategy and calendar\n- Graphic design and copywriting\n- Short videos and reels\n- Community management during business hours\n- Paid campaign setup and optimisation\n- Monthly performance report",
      deliverables: "- Agreed number of posts and reels per month\n- Monthly report with results and next steps",
      exclusions: "- Advertising spend, which is paid directly to the platforms\n- Influencer fees and photo or video shoots unless listed",
      timeline: "",
      investment: "",
      payment_schedule: "",
      terms: DEFAULT_TERMS,
      acceptance: ACCEPTANCE_TEXT,
    },
    investment: [{ title: "Social media management (monthly)", detail: "Strategy, content, community management and reporting", qty100: 100, unitPrice: 0 }],
    investmentNotes: "Advertising budget is not included and is paid directly to the platforms.",
    timeline: [
      { phase: "Onboarding and strategy", duration: "1 week" },
      { phase: "Monthly content cycle", duration: "Ongoing, monthly" },
    ],
    paymentSchedule: [{ label: "Monthly, in advance", type: "percent", value: 10000 }],
  },
  seo: {
    label: "SEO",
    projectTitle: "Search engine optimisation",
    sections: {
      executive_summary: "10X Creative will improve your visibility in search results so more of the right people find your business.",
      requirements: "We understand that you want to rank for the searches your customers use and to turn that traffic into enquiries.",
      scope: "- Technical SEO audit and fixes\n- Keyword research and on-page optimisation\n- Content recommendations\n- Local SEO and Google Business Profile\n- Monthly reporting",
      deliverables: "- Audit report with priorities\n- Monthly ranking and traffic report",
      exclusions: "- Guaranteed rankings, which no provider can promise\n- Paid link buying",
      timeline: "",
      investment: "",
      payment_schedule: "",
      terms: DEFAULT_TERMS,
      acceptance: ACCEPTANCE_TEXT,
    },
    investment: [
      { title: "SEO audit and setup", detail: "One-time", qty100: 100, unitPrice: 0 },
      { title: "Monthly SEO", detail: "Ongoing optimisation and reporting", qty100: 100, unitPrice: 0 },
    ],
    timeline: [
      { phase: "Audit and setup", duration: "2 weeks" },
      { phase: "Ongoing optimisation", duration: "Monthly" },
    ],
    paymentSchedule: [
      { label: "Setup on acceptance", type: "percent", value: 5000 },
      { label: "On completion of setup", type: "percent", value: 5000 },
    ],
  },
  blank: {
    label: "Blank",
    projectTitle: "",
    sections: Object.fromEntries(SECTION_ORDER.map((s) => [s.key, s.key === "terms" ? DEFAULT_TERMS : s.key === "acceptance" ? ACCEPTANCE_TEXT : ""])),
    investment: [{ title: "", qty100: 100, unitPrice: 0 }],
    timeline: [],
    paymentSchedule: [
      { label: "Advance on acceptance", type: "percent", value: 5000 },
      { label: "On completion", type: "percent", value: 5000 },
    ],
  },
};

export function templateSections(key: string): ProposalSection[] {
  const t = PROPOSAL_TEMPLATES[key] ?? PROPOSAL_TEMPLATES.blank;
  return SECTION_ORDER.map((s) => ({ key: s.key, title: s.title, body: t.sections[s.key] ?? "", hidden: false }));
}
