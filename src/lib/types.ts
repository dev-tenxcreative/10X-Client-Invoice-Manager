import type { ObjectId } from "mongodb";

export type Role = "super_admin" | "admin" | "client";
export type UserStatus = "invited" | "active" | "deactivated";
export type Currency = "LKR" | "USD";

export interface UserDoc {
  _id: ObjectId;
  email: string; // lower-case
  name: string;
  phone?: string;
  designation?: string;
  role: Role;
  status: UserStatus;
  passwordHash?: string;
  lastSignInAt?: Date;
  invitedAt?: Date;
  activatedAt?: Date;
  isDemo?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface SessionDoc {
  _id: ObjectId;
  tokenHash: string;
  userId: ObjectId;
  role: Role;
  expiresAt: Date;
  createdAt: Date;
  lastSeenAt: Date;
  ip?: string;
  userAgent?: string;
}

export type AuthTokenType = "activation" | "reset";
export interface AuthTokenDoc {
  _id: ObjectId;
  tokenHash: string;
  userId: ObjectId;
  type: AuthTokenType;
  expiresAt: Date;
  usedAt?: Date;
  createdAt: Date;
}

export interface CompanyDoc {
  _id: ObjectId;
  name: string;
  nameLower: string;
  billingAddress: string;
  city: string;
  country: string;
  taxNumber?: string;
  billingEmails: string[];
  currency: Currency;
  paymentTermsDays: number;
  notes?: string;
  status: "active" | "archived";
  reminderOffsets?: number[]; // overrides Settings when set
  isDemo?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface MembershipDoc {
  _id: ObjectId;
  userId: ObjectId;
  companyId: ObjectId;
  isPrimary: boolean;
  createdAt: Date;
}

/** Quantity is stored in hundredths (1.5 hours = 150). Money is integer minor units. */
export interface LineItem {
  title: string;
  detail?: string;
  qty100: number;
  unitPrice: number;
  amount: number;
  period?: string; // label such as "November 2026"
}

export interface Discount {
  type: "none" | "amount" | "percent";
  value: number; // minor units for amount, basis points for percent
}

export interface Tax {
  label: string;
  rateBp: number; // 1000 = 10%
}

export interface Totals {
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
}

export type InvoiceStatus = "draft" | "sent" | "viewed" | "partially_paid" | "paid" | "void";
export type DisplayInvoiceStatus = InvoiceStatus | "overdue";

export interface InvoiceDoc extends Totals {
  _id: ObjectId;
  number: string;
  companyId: ObjectId;
  source: "generated" | "uploaded";
  status: InvoiceStatus;
  issueDate: string; // YYYY-MM-DD (Asia/Colombo)
  dueDate: string;
  currency: Currency;
  items: LineItem[];
  discount: Discount;
  tax: Tax;
  paidTotal: number;
  balance: number;
  notes?: string;
  description?: string; // uploaded invoices
  paymentInstructions?: string;
  billingPeriod?: string; // e.g. "November 2026"
  planId?: ObjectId;
  period?: string; // YYYY-MM for plan invoices (unique with planId)
  proposalId?: ObjectId;
  milestoneIndex?: number;
  fileId?: ObjectId; // uploaded source PDF
  pdf?: { fileId: ObjectId; hash: string };
  remindersEnabled: boolean;
  followUp?: boolean;
  voidReason?: string;
  replacesInvoiceId?: ObjectId;
  sentAt?: Date;
  viewedAt?: Date;
  paidAt?: Date;
  lastPaymentDate?: string;
  isDemo?: boolean;
  createdBy: ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export type PaymentMethod = "bank_transfer" | "cash" | "cheque" | "online" | "other";
export interface PaymentDoc {
  _id: ObjectId;
  invoiceId: ObjectId;
  companyId: ObjectId;
  date: string;
  amount: number;
  currency: Currency;
  method: PaymentMethod;
  reference?: string;
  note?: string;
  fileId?: ObjectId;
  submissionId?: ObjectId;
  isDemo?: boolean;
  createdBy: ObjectId;
  createdAt: Date;
}

export interface PaymentSubmissionDoc {
  _id: ObjectId;
  invoiceId: ObjectId;
  companyId: ObjectId;
  userId: ObjectId;
  amount: number;
  currency: Currency;
  date: string;
  reference?: string;
  fileId: ObjectId;
  status: "pending" | "confirmed" | "rejected";
  rejectReason?: string;
  paymentId?: ObjectId;
  reviewedBy?: ObjectId;
  reviewedAt?: Date;
  createdAt: Date;
}

export interface RecurringPlanDoc {
  _id: ObjectId;
  companyId: ObjectId;
  name: string;
  items: LineItem[];
  currency: Currency;
  discount: Discount;
  tax: Tax;
  startDate: string;
  billingDay: number; // 1..28
  dueAfterDays: number;
  endDate?: string;
  status: "active" | "paused" | "ended";
  mode: "auto" | "review";
  notes?: string;
  skippedPeriods: string[];
  proposalId?: ObjectId;
  lastRunAt?: Date;
  isDemo?: boolean;
  createdBy: ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export type ProposalStatus = "draft" | "sent" | "viewed" | "accepted" | "declined" | "expired";
export interface ProposalSection {
  key: string;
  title: string;
  body: string; // limited markdown: **bold**, lists, [links](url)
  hidden: boolean;
}
export interface Milestone {
  label: string;
  type: "percent" | "amount";
  value: number; // bp or minor units
  dueNote?: string;
}
export interface TimelineRow {
  phase: string;
  duration: string;
  notes?: string;
}
export interface ProposalContent {
  title: string;
  projectTitle: string;
  date: string;
  validUntil: string;
  currency: Currency;
  sections: ProposalSection[];
  investment: LineItem[];
  investmentNotes?: string;
  discount: Discount;
  tax: Tax;
  timeline: TimelineRow[];
  paymentSchedule: Milestone[];
}
export interface ProposalDoc extends Totals {
  _id: ObjectId;
  reference: string;
  companyId: ObjectId;
  source: "built" | "uploaded";
  template: string;
  status: ProposalStatus;
  version: number;
  content: ProposalContent;
  versions: { version: number; content: ProposalContent; totals: Totals; savedAt: Date }[];
  fileId?: ObjectId;
  signedFileId?: ObjectId;
  pdf?: { fileId: ObjectId; hash: string };
  acceptance?: {
    name: string;
    designation: string;
    at: Date;
    ip?: string;
    version: number;
    method: "online" | "manual";
    userId?: ObjectId;
  };
  decline?: { reason?: string; at: Date; userId?: ObjectId };
  sentAt?: Date;
  viewedAt?: Date;
  invoicesCreatedAt?: Date;
  planId?: ObjectId;
  isDemo?: boolean;
  createdBy: ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export interface FileDoc {
  _id: ObjectId;
  key: string;
  originalName: string;
  contentType: string;
  size: number;
  companyId?: ObjectId;
  kind: "invoice_upload" | "proposal_upload" | "proposal_signed" | "receipt" | "slip" | "invoice_pdf" | "proposal_pdf" | "logo" | "test";
  relatedId?: ObjectId;
  uploadedBy?: ObjectId;
  createdAt: Date;
}

export interface EmailLogDoc {
  _id: ObjectId;
  to: string[];
  cc: string[];
  subject: string;
  html: string;
  text: string;
  template: string;
  attachments: { filename: string; fileId: ObjectId }[];
  status: "queued" | "sent" | "failed";
  provider?: string;
  error?: string;
  attempts: number;
  nextAttemptAt?: Date;
  related?: { type: string; id: ObjectId };
  createdAt: Date;
  sentAt?: Date;
}

export interface ReminderLogDoc {
  _id: ObjectId;
  invoiceId: ObjectId;
  step: number;
  emailLogId?: ObjectId;
  sentAt: Date;
}

export interface AuditLogDoc {
  _id: ObjectId;
  actorId?: ObjectId;
  actorEmail?: string;
  action: string;
  entityType: string;
  entityId?: ObjectId | string;
  before?: unknown;
  after?: unknown;
  ip?: string;
  at: Date;
}

export interface EmailTemplate {
  subject: string;
  body: string;
  buttonLabel?: string;
}

export interface SettingsDoc {
  _id: "global";
  legalName: string;
  brandName: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  registrationNumber: string;
  taxNumber: string;
  signatoryName: string;
  signatoryTitle: string;
  logoFileId?: ObjectId;
  bank: {
    bankName: string;
    branch: string;
    accountName: string;
    accountNumber: string;
    swift: string;
  };
  defaultCurrency: Currency;
  currencies: Currency[];
  tax: Tax;
  defaultPaymentTermsDays: number;
  numbering: { invoicePrefix: string; proposalPrefix: string };
  reminderOffsets: number[];
  emailDailyLimit: number;
  invoiceNotes: string;
  invoiceThankYou: string;
  emailTemplates: Record<string, EmailTemplate>;
  updatedAt: Date;
}

export interface TextBlockDoc {
  _id: ObjectId;
  title: string;
  category: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CounterDoc {
  _id: string; // `${type}-${year}`
  type: string;
  year: number;
  seq: number;
}

export interface JobRunDoc {
  _id: string; // e.g. "digest-2026-11-16"
  at: Date;
}
