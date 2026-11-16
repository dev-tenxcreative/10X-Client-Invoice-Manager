import type { EmailTemplate, SettingsDoc } from "./types";

/*
 * Default email templates. Variables in {{double_braces}} are filled in when sending and are
 * HTML-escaped. Blank lines separate paragraphs. The button links to {{action_link}}.
 */
export const DEFAULT_EMAIL_TEMPLATES: Record<string, EmailTemplate> = {
  activation: {
    subject: "Set up your 10X Creative portal account",
    body: "Hello {{client_name}},\n\nAn account has been created for you on the 10X Creative client portal. Use the button below to set your password. The link works once and expires in 72 hours.\n\nIf you were not expecting this email, you can ignore it.",
    buttonLabel: "Set your password",
  },
  password_reset: {
    subject: "Reset your 10X Creative portal password",
    body: "Hello {{client_name}},\n\nWe received a request to reset your password. Use the button below to choose a new one. The link works once and expires in 60 minutes.\n\nIf you did not ask for this, you can ignore this email. Your password will not change.",
    buttonLabel: "Reset password",
  },
  password_changed: {
    subject: "Your 10X Creative portal password was changed",
    body: "Hello {{client_name}},\n\nYour portal password was changed and you were signed out of all other devices.\n\nIf you did not do this, reply to this email straight away.",
    buttonLabel: "Open the portal",
  },
  invoice_sent: {
    subject: "Invoice {{invoice_number}} from 10X Creative",
    body: "Hello {{client_name}},\n\nPlease find invoice {{invoice_number}} for {{company_name}} attached.\n\nAmount due: {{amount_due}}\nDue date: {{due_date}}\n\n{{unpaid_summary}}\n\nYou can view the invoice, download it and upload a payment slip in the portal. Please use the invoice number as your payment reference.",
    buttonLabel: "View invoice",
  },
  reminder_before: {
    subject: "Reminder: invoice {{invoice_number}} is due on {{due_date}}",
    body: "Hello {{client_name}},\n\nThis is a friendly reminder that invoice {{invoice_number}} for {{company_name}} is due on {{due_date}}.\n\nAmount due: {{amount_due}}\n\nIf you have already paid, please upload the payment slip in the portal so we can confirm it.",
    buttonLabel: "View invoice",
  },
  reminder_due: {
    subject: "Invoice {{invoice_number}} is due today",
    body: "Hello {{client_name}},\n\nInvoice {{invoice_number}} for {{company_name}} is due today.\n\nAmount due: {{amount_due}}\n\nIf you have already paid, please upload the payment slip in the portal so we can confirm it.",
    buttonLabel: "View invoice",
  },
  reminder_overdue: {
    subject: "Overdue: invoice {{invoice_number}}",
    body: "Hello {{client_name}},\n\nInvoice {{invoice_number}} for {{company_name}} was due on {{due_date}} and is now {{days_overdue}} days overdue.\n\nAmount due: {{amount_due}}\n\nPlease arrange payment, or upload your payment slip in the portal if you have already paid. Reply to this email if you have any questions.",
    buttonLabel: "View invoice",
  },
  payment_receipt: {
    subject: "Payment received for invoice {{invoice_number}}",
    body: "Hello {{client_name}},\n\nThank you. We have received full payment for invoice {{invoice_number}}. The paid invoice is attached for your records.\n\nAmount paid: {{amount_paid}}",
    buttonLabel: "View invoice",
  },
  payment_recorded: {
    subject: "Payment recorded for invoice {{invoice_number}}",
    body: "Hello {{client_name}},\n\nWe have recorded a payment of {{amount_paid}} against invoice {{invoice_number}}.\n\nRemaining balance: {{amount_due}}",
    buttonLabel: "View invoice",
  },
  slip_submitted_admin: {
    subject: "Payment slip to confirm: {{invoice_number}}",
    body: "{{company_name}} uploaded a payment slip of {{amount_paid}} for invoice {{invoice_number}}.\n\nPlease check it and confirm or reject it.",
    buttonLabel: "Review payment slip",
  },
  slip_received_client: {
    subject: "We received your payment slip for {{invoice_number}}",
    body: "Hello {{client_name}},\n\nThank you. We received your payment slip of {{amount_paid}} for invoice {{invoice_number}}. We will confirm it shortly.",
    buttonLabel: "View invoice",
  },
  slip_confirmed: {
    subject: "Payment confirmed for invoice {{invoice_number}}",
    body: "Hello {{client_name}},\n\nYour payment of {{amount_paid}} for invoice {{invoice_number}} has been confirmed.\n\nRemaining balance: {{amount_due}}",
    buttonLabel: "View invoice",
  },
  slip_rejected: {
    subject: "We could not confirm your payment for {{invoice_number}}",
    body: "Hello {{client_name}},\n\nWe could not confirm the payment slip you uploaded for invoice {{invoice_number}}.\n\nReason: {{reason}}\n\nPlease check the details and upload the slip again, or reply to this email.",
    buttonLabel: "View invoice",
  },
  proposal_sent: {
    subject: "Proposal {{proposal_reference}}: {{proposal_title}}",
    body: "Hello {{client_name}},\n\nThank you for the opportunity. Our proposal {{proposal_reference}} for {{company_name}} is ready for you to review.\n\nTotal: {{proposal_total}}\nValid until: {{valid_until}}\n\nYou can read it, download it and accept or decline it online in the portal.",
    buttonLabel: "View proposal",
  },
  proposal_response_admin: {
    subject: "Proposal {{proposal_reference}} was {{response}}",
    body: "{{company_name}} {{response}} proposal {{proposal_reference}} ({{proposal_title}}).\n\n{{details}}",
    buttonLabel: "Open proposal",
  },
  plan_draft_admin: {
    subject: "Draft invoice ready for review: {{invoice_number}}",
    body: "The recurring plan \"{{plan_name}}\" for {{company_name}} created draft invoice {{invoice_number}} for {{amount_due}}.\n\nPlease review it and send it to the client.",
    buttonLabel: "Review draft",
  },
  overdue_digest_admin: {
    subject: "Weekly overdue invoices: {{count}} invoice(s)",
    body: "These invoices are overdue as of {{today}}:\n\n{{list}}",
    buttonLabel: "Open invoices",
  },
  follow_up_admin: {
    subject: "Follow up needed: invoice {{invoice_number}}",
    body: "All reminders have been sent for invoice {{invoice_number}} ({{company_name}}) and it is still unpaid.\n\nAmount due: {{amount_due}}\nDue date: {{due_date}}\n\nPlease follow up personally.",
    buttonLabel: "Open invoice",
  },
  test: {
    subject: "Test email from the 10X Creative portal",
    body: "Hello {{client_name}},\n\nThis is a test email. If you can read it, email sending works.",
    buttonLabel: "Open the portal",
  },
};

export const EMAIL_TEMPLATE_LABELS: Record<string, string> = {
  activation: "Account activation",
  password_reset: "Password reset",
  password_changed: "Password changed",
  invoice_sent: "Invoice sent",
  reminder_before: "Reminder: before due date",
  reminder_due: "Reminder: due today",
  reminder_overdue: "Reminder: overdue",
  payment_receipt: "Receipt (fully paid)",
  payment_recorded: "Payment recorded (partial)",
  slip_submitted_admin: "Admin: payment slip uploaded",
  slip_received_client: "Client: payment slip received",
  slip_confirmed: "Client: payment slip confirmed",
  slip_rejected: "Client: payment slip rejected",
  proposal_sent: "Proposal sent",
  proposal_response_admin: "Admin: proposal accepted or declined",
  plan_draft_admin: "Admin: recurring draft ready",
  overdue_digest_admin: "Admin: weekly overdue digest",
  follow_up_admin: "Admin: follow-up needed",
  test: "Test email",
};

export function defaultSettings(): SettingsDoc {
  return {
    _id: "global",
    legalName: "10X Creative (Pvt) Ltd",
    brandName: "10X Creative",
    address: "No 134 1/1, Philip Gunawardena Mawatha, Colombo 04, Sri Lanka",
    phone: "+94 76 371 1125",
    email: "billing@tenxcreative.com",
    website: "www.tenxcreative.com",
    registrationNumber: "",
    taxNumber: "",
    signatoryName: "Ajwad Ameer",
    signatoryTitle: "Founder / Managing Director",
    // Bank details are intentionally empty: fill them in Settings. Empty rows are hidden on documents.
    bank: { bankName: "", branch: "", accountName: "", accountNumber: "", swift: "" },
    defaultCurrency: "LKR",
    currencies: ["LKR", "USD"],
    tax: { label: "VAT", rateBp: 0 },
    defaultPaymentTermsDays: 14,
    numbering: { invoicePrefix: "10X-INV", proposalPrefix: "10X-PRO" },
    reminderOffsets: [-3, 0, 3, 7, 14],
    emailDailyLimit: 400,
    invoiceNotes: "",
    invoiceThankYou: "Thank you for your business.",
    emailTemplates: DEFAULT_EMAIL_TEMPLATES,
    updatedAt: new Date(),
  };
}
