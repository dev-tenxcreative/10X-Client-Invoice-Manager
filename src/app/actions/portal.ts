"use server";

import { z } from "zod";
import { getPortalContext } from "@/lib/auth/session";
import { AppError, ForbiddenError, toActionError, type ActionResult } from "@/lib/errors";
import { fileFrom, formObject, moneyField, oid, parseEmails, parseWith, zDate, zOptText, zText } from "@/lib/forms";
import { validateUpload, UploadError } from "@/lib/storage";
import { limited } from "@/lib/auth/rate-limit";
import { submitSlip } from "@/lib/services/payments";
import { acceptOnline, declineOnline } from "@/lib/services/proposals";
import { updateBillingByClient } from "@/lib/services/companies";
import { getInvoice } from "@/lib/services/invoices";

/** Every portal action re-derives the user's companies on the server and blocks previews. */
async function ctx() {
  const c = await getPortalContext();
  if (c.readOnly) throw new ForbiddenError("This is a read-only preview.");
  return c;
}

export async function submitSlipAction(fd: FormData): Promise<ActionResult> {
  try {
    const c = await ctx();
    const d = formObject(fd);
    if (await limited(`upload:${c.auth.user._id}`, 20, 60 * 60 * 1000)) throw new AppError("Too many uploads. Please try again later.");
    const inv = await getInvoice(oid(d.invoiceId));
    if (!inv || !c.companyIds.some((id) => id.equals(inv.companyId))) throw new ForbiddenError();
    const p = parseWith(z.object({ date: zDate("the date you paid"), reference: zOptText(120) }), d);
    const amount = moneyField(d.amount, inv.currency, "amount");
    const f = fileFrom(fd, "file");
    let bytes: Uint8Array;
    try {
      bytes = await validateUpload(f);
    } catch (e) {
      if (e instanceof UploadError) throw new AppError(e.message, "file");
      throw e;
    }
    await submitSlip(c.auth.actor, c.companyIds, { invoiceId: inv._id, amount, date: p.date, reference: p.reference, file: { bytes, name: f!.name } });
    return { ok: true, message: "Thank you. We received your payment slip and will confirm it shortly." };
  } catch (e) {
    return toActionError(e, "submitSlip");
  }
}

export async function acceptProposalAction(fd: FormData): Promise<ActionResult> {
  try {
    const c = await ctx();
    const d = formObject(fd);
    await acceptOnline(c.auth.actor, c.companyIds, oid(d.id), { name: d.name ?? "", designation: d.designation ?? "", agree: d.agree === "on" });
    return { ok: true, message: "Thank you. The proposal is accepted and our team has been notified." };
  } catch (e) {
    return toActionError(e, "acceptProposal");
  }
}

export async function declineProposalAction(fd: FormData): Promise<ActionResult> {
  try {
    const c = await ctx();
    await declineOnline(c.auth.actor, c.companyIds, oid(String(fd.get("id"))), String(fd.get("reason") ?? "").slice(0, 1000));
    return { ok: true, message: "Thank you for letting us know. Our team has been notified." };
  } catch (e) {
    return toActionError(e, "declineProposal");
  }
}

export async function updateBillingAction(fd: FormData): Promise<ActionResult> {
  try {
    const c = await ctx();
    const d = formObject(fd);
    const p = parseWith(z.object({ billingAddress: zText("the billing address", 300), city: zText("the city", 100), country: zText("the country", 100) }), d);
    await updateBillingByClient(c.auth.actor, c.company._id, { ...p, billingEmails: parseEmails(d.billingEmails, "billingEmails") });
    return { ok: true, message: "Billing details saved." };
  } catch (e) {
    return toActionError(e, "updateBilling");
  }
}
