"use server";

import { z } from "zod";
import { cookies } from "next/headers";
import { ObjectId } from "mongodb";
import { createSession, destroySession, getAuth, requestMeta, requireUser, COMPANY_COOKIE, VIEW_AS_COOKIE, requireAdmin } from "@/lib/auth/session";
import { activateAccount, changePassword, requestFirstTimeLink, requestPasswordReset, resetPassword, signOutEverywhere, updateProfile, verifySignIn } from "@/lib/services/users";
import { toActionError, type ActionResult } from "@/lib/errors";
import { formObject, parseWith, zEmail } from "@/lib/forms";
import { isAdminRole } from "@/lib/permissions";
import { t } from "@/lib/i18n";
import { cols } from "@/lib/db";

export async function signInAction(fd: FormData): Promise<ActionResult> {
  try {
    const data = formObject(fd);
    const email = (data.email ?? "").trim();
    const password = data.password ?? "";
    if (!email || !password) return { ok: false, error: "Please enter your email and password." };
    const { ip } = await requestMeta();
    const res = await verifySignIn(email, password, ip, data["cf-turnstile-response"]);
    if (!res.ok) return { ok: false, error: res.locked ? t.auth.locked : t.auth.genericError, needCaptcha: res.needCaptcha };
    await createSession(res.user);
    return { ok: true, redirect: isAdminRole(res.user.role) ? "/admin" : "/portal" };
  } catch (e) {
    return toActionError(e, "signIn");
  }
}

export async function firstTimeAction(fd: FormData): Promise<ActionResult> {
  try {
    const { email } = parseWith(z.object({ email: zEmail }), formObject(fd));
    const { ip } = await requestMeta();
    await requestFirstTimeLink(email, ip);
    return { ok: true, message: t.auth.firstTimeSent };
  } catch (e) {
    return toActionError(e, "firstTime");
  }
}

export async function forgotPasswordAction(fd: FormData): Promise<ActionResult> {
  try {
    const { email } = parseWith(z.object({ email: zEmail }), formObject(fd));
    const { ip } = await requestMeta();
    await requestPasswordReset(email, ip);
    return { ok: true, message: t.auth.forgotSent };
  } catch (e) {
    return toActionError(e, "forgot");
  }
}

export async function activateAction(fd: FormData): Promise<ActionResult> {
  try {
    const d = formObject(fd);
    const { ip } = await requestMeta();
    const user = await activateAccount(d.token ?? "", d.password ?? "", d.confirm ?? "", ip);
    await createSession(user);
    return { ok: true, message: "Your password is set. Welcome!", redirect: isAdminRole(user.role) ? "/admin" : "/portal" };
  } catch (e) {
    return toActionError(e, "activate");
  }
}

export async function resetPasswordAction(fd: FormData): Promise<ActionResult> {
  try {
    const d = formObject(fd);
    const { ip } = await requestMeta();
    const user = await resetPassword(d.token ?? "", d.password ?? "", d.confirm ?? "", ip);
    await createSession(user);
    return { ok: true, message: "Your password was changed. You were signed out of other devices.", redirect: isAdminRole(user.role) ? "/admin" : "/portal" };
  } catch (e) {
    return toActionError(e, "reset");
  }
}

export async function signOutAction(): Promise<ActionResult> {
  await destroySession();
  return { ok: true, redirect: "/sign-in" };
}

export async function signOutAllAction(): Promise<ActionResult> {
  try {
    const auth = await requireUser();
    await signOutEverywhere(auth.actor);
    await destroySession();
    return { ok: true, redirect: "/sign-in" };
  } catch (e) {
    return toActionError(e, "signOutAll");
  }
}

export async function changePasswordAction(fd: FormData): Promise<ActionResult> {
  try {
    const auth = await requireUser();
    const d = formObject(fd);
    await changePassword(auth.actor, d.current ?? "", d.password ?? "", d.confirm ?? "", auth.sessionHash);
    return { ok: true, message: "Password changed. Other devices were signed out." };
  } catch (e) {
    return toActionError(e, "changePassword");
  }
}

export async function updateProfileAction(fd: FormData): Promise<ActionResult> {
  try {
    const auth = await requireUser();
    const d = formObject(fd);
    await updateProfile(auth.actor, { name: d.name ?? "", phone: d.phone });
    return { ok: true, message: "Your details were saved." };
  } catch (e) {
    return toActionError(e, "profile");
  }
}

export async function switchCompanyAction(fd: FormData): Promise<ActionResult> {
  const auth = await getAuth();
  if (!auth) return { ok: false, error: "Please sign in again." };
  const id = String(fd.get("companyId") ?? "");
  if (!ObjectId.isValid(id)) return { ok: false, error: "Unknown company." };
  const c = await cols();
  const member = await c.memberships.findOne({ userId: auth.user._id, companyId: new ObjectId(id) });
  if (!member) return { ok: false, error: "Unknown company." };
  (await cookies()).set(COMPANY_COOKIE, id, { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" });
  return { ok: true, redirect: "/portal" };
}

/** Admin "View as client": read-only preview of what a company's contacts see. */
export async function viewAsClientAction(fd: FormData): Promise<ActionResult> {
  try {
    const auth = await requireAdmin();
    const id = String(fd.get("companyId") ?? "");
    if (!ObjectId.isValid(id)) return { ok: false, error: "Unknown company." };
    (await cookies()).set(VIEW_AS_COOKIE, id, { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 });
    void auth;
    return { ok: true, redirect: "/portal" };
  } catch (e) {
    return toActionError(e, "viewAs");
  }
}

export async function exitViewAsAction(): Promise<ActionResult> {
  (await cookies()).delete(VIEW_AS_COOKIE);
  return { ok: true, redirect: "/admin/companies" };
}
