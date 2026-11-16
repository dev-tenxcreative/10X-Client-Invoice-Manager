import type { DisplayInvoiceStatus, InvoiceDoc, InvoiceStatus } from "./types";

export const OPEN_STATUSES: InvoiceStatus[] = ["sent", "viewed", "partially_paid"];

/** Overdue is derived: unpaid (open with a balance) and past the due date. */
export function isOverdue(inv: Pick<InvoiceDoc, "status" | "dueDate" | "balance">, today: string): boolean {
  return OPEN_STATUSES.includes(inv.status) && inv.balance > 0 && inv.dueDate < today;
}

export function displayStatus(inv: Pick<InvoiceDoc, "status" | "dueDate" | "balance">, today: string): DisplayInvoiceStatus {
  return isOverdue(inv, today) ? "overdue" : inv.status;
}

export const STATUS_LABEL: Record<DisplayInvoiceStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  viewed: "Viewed",
  partially_paid: "Partially paid",
  paid: "Paid",
  overdue: "Overdue",
  void: "Void",
};

/** Status after a payment change. */
export function statusAfterPayment(inv: Pick<InvoiceDoc, "status" | "total">, paidTotal: number): InvoiceStatus {
  if (inv.status === "void" || inv.status === "draft") return inv.status;
  if (paidTotal >= inv.total) return "paid";
  if (paidTotal > 0) return "partially_paid";
  return inv.status === "paid" || inv.status === "partially_paid" ? "sent" : inv.status;
}
