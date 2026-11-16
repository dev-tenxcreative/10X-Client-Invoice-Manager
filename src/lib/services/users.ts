import { ObjectId, type ClientSession } from "mongodb";
import { cols } from "../db";
import { appUrl, superAdminEmail } from "../env";
import { AppError, ForbiddenError, NotFoundError } from "../errors";
import { hashPassword, randomToken, sha256, verifyPassword } from "../auth/crypto";
import { passwordProblem } from "../auth/password-policy";
import { clearHits, hit, recentHits, turnstileEnabled, verifyTurnstile } from "../auth/rate-limit";
import { sendEmail } from "../email";
import { audit, type Actor } from "./audit";
import type { AuthTokenType, Role, UserDoc } from "../types";

export const ACTIVATION_TTL_MS = 72 * 60 * 60 * 1000;
export const RESET_TTL_MS = 60 * 60 * 1000;
export const SIGNIN_WINDOW_MS = 15 * 60 * 1000;
export const SIGNIN_MAX_FAILURES = 5;

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isProtectedSuperAdmin(user: Pick<UserDoc, "email" | "role">): boolean {
  return user.role === "super_admin" || user.email === superAdminEmail();
}

/** Throws if the change would remove, deactivate, demote or rename the super admin. */
export function assertMayModify(target: Pick<UserDoc, "email" | "role">, change: "deactivate" | "remove" | "role" | "email") {
  if (isProtectedSuperAdmin(target)) {
    throw new ForbiddenError(
      change === "email" ? "The super admin's email cannot be changed." : "The super admin account cannot be deactivated, removed or demoted.",
    );
  }
}

export async function findUserByEmail(email: string) {
  const c = await cols();
  return c.users.findOne({ email: normaliseEmail(email) });
}

export async function createUser(
  input: { name: string; email: string; role: Role; phone?: string; designation?: string; isDemo?: boolean },
  session?: ClientSession,
): Promise<UserDoc> {
  const c = await cols();
  const email = normaliseEmail(input.email);
  if (await c.users.findOne({ email }, { session })) throw new AppError("A user with this email already exists.", "email");
  const now = new Date();
  const user: UserDoc = {
    _id: new ObjectId(),
    email,
    name: input.name.trim(),
    phone: input.phone?.trim() || undefined,
    designation: input.designation?.trim() || undefined,
    role: input.role,
    status: "invited",
    isDemo: input.isDemo,
    createdAt: now,
    updatedAt: now,
  };
  await c.users.insertOne(user, { session });
  return user;
}

async function issueToken(userId: ObjectId, type: AuthTokenType, session?: ClientSession): Promise<string> {
  const c = await cols();
  // Only the newest link of each type works.
  await c.authTokens.updateMany({ userId, type, usedAt: { $exists: false } }, { $set: { usedAt: new Date() } }, { session });
  const raw = randomToken(32);
  await c.authTokens.insertOne(
    {
      _id: new ObjectId(),
      tokenHash: sha256(raw),
      userId,
      type,
      expiresAt: new Date(Date.now() + (type === "activation" ? ACTIVATION_TTL_MS : RESET_TTL_MS)),
      createdAt: new Date(),
    },
    { session },
  );
  return raw;
}

export async function createActivationToken(userId: ObjectId, session?: ClientSession) {
  return issueToken(userId, "activation", session);
}

export async function sendActivationEmail(user: UserDoc, rawToken: string) {
  const c = await cols();
  await c.users.updateOne({ _id: user._id }, { $set: { invitedAt: new Date() } });
  return sendEmail({
    template: "activation",
    to: [user.email],
    vars: { client_name: user.name, action_link: appUrl(`/activate/${rawToken}`), portal_link: appUrl("/sign-in") },
    related: { type: "user", id: user._id },
  });
}

export async function inviteAndEmail(user: UserDoc) {
  const token = await createActivationToken(user._id);
  return sendActivationEmail(user, token);
}

/** "First time here?" Always behaves the same from the outside. */
export async function requestFirstTimeLink(email: string, ip: string): Promise<void> {
  const e = normaliseEmail(email);
  if ((await recentHits(`activation:${ip}`, SIGNIN_WINDOW_MS)) >= 10) return;
  await hit(`activation:${ip}`);
  const user = await findUserByEmail(e);
  if (!user || user.status !== "invited") return;
  if ((await recentHits(`activation-email:${e}`, SIGNIN_WINDOW_MS)) >= 3) return;
  await hit(`activation-email:${e}`);
  await inviteAndEmail(user);
}

export async function findValidToken(raw: string, type: AuthTokenType) {
  const c = await cols();
  if (!raw || raw.length < 20) return null;
  const token = await c.authTokens.findOne({ tokenHash: sha256(raw), type });
  if (!token || token.usedAt || token.expiresAt < new Date()) return null;
  const user = await c.users.findOne({ _id: token.userId });
  if (!user) return null;
  if (type === "activation" && user.status !== "invited") return null;
  if (type === "reset" && user.status !== "active") return null;
  return { token, user };
}

export async function activateAccount(raw: string, password: string, confirm: string, ip?: string): Promise<UserDoc> {
  if (password !== confirm) throw new AppError("The two passwords do not match.", "confirm");
  const found = await findValidToken(raw, "activation");
  if (!found) throw new AppError("This link is no longer valid. Use \"First time here?\" on the sign-in page to get a new one.");
  const problem = passwordProblem(password, found.user.email);
  if (problem) throw new AppError(problem, "password");
  const c = await cols();
  const passwordHash = await hashPassword(password);
  const used = await c.authTokens.updateOne({ _id: found.token._id, usedAt: { $exists: false } }, { $set: { usedAt: new Date() } });
  if (used.modifiedCount !== 1) throw new AppError("This link has already been used.");
  await c.users.updateOne(
    { _id: found.user._id, status: "invited" },
    { $set: { passwordHash, status: "active", activatedAt: new Date(), updatedAt: new Date() } },
  );
  await audit({ userId: found.user._id, email: found.user.email, role: found.user.role, name: found.user.name, ip }, "user.activate", "user", found.user._id);
  return { ...found.user, status: "active", passwordHash };
}

export async function requestPasswordReset(email: string, ip: string): Promise<void> {
  const e = normaliseEmail(email);
  if ((await recentHits(`reset:${ip}`, SIGNIN_WINDOW_MS)) >= 10) return;
  await hit(`reset:${ip}`);
  const user = await findUserByEmail(e);
  if (!user || user.status !== "active") return;
  if ((await recentHits(`reset-email:${e}`, SIGNIN_WINDOW_MS)) >= 3) return;
  await hit(`reset-email:${e}`);
  const raw = await issueToken(user._id, "reset");
  await sendEmail({
    template: "password_reset",
    to: [user.email],
    vars: { client_name: user.name, action_link: appUrl(`/reset-password/${raw}`) },
    related: { type: "user", id: user._id },
  });
}

export async function resetPassword(raw: string, password: string, confirm: string, ip?: string): Promise<UserDoc> {
  if (password !== confirm) throw new AppError("The two passwords do not match.", "confirm");
  const found = await findValidToken(raw, "reset");
  if (!found) throw new AppError("This reset link is no longer valid. Please ask for a new one.");
  const problem = passwordProblem(password, found.user.email);
  if (problem) throw new AppError(problem, "password");
  const c = await cols();
  const used = await c.authTokens.updateOne({ _id: found.token._id, usedAt: { $exists: false } }, { $set: { usedAt: new Date() } });
  if (used.modifiedCount !== 1) throw new AppError("This link has already been used.");
  await c.users.updateOne({ _id: found.user._id }, { $set: { passwordHash: await hashPassword(password), updatedAt: new Date() } });
  await c.sessions.deleteMany({ userId: found.user._id });
  await audit({ userId: found.user._id, email: found.user.email, role: found.user.role, name: found.user.name, ip }, "user.password_reset", "user", found.user._id);
  await sendEmail({ template: "password_changed", to: [found.user.email], vars: { client_name: found.user.name, action_link: appUrl("/sign-in") } }).catch(() => {});
  return found.user;
}

export type SignInResult =
  | { ok: true; user: UserDoc }
  | { ok: false; needCaptcha: boolean; locked: boolean };

/** Max 5 failures per 15 minutes per email+IP. Turnstile after the second failure. */
export async function verifySignIn(email: string, password: string, ip: string, captchaToken?: string | null): Promise<SignInResult> {
  const e = normaliseEmail(email);
  const key = `signin:${e}:${ip}`;
  const failures = await recentHits(key, SIGNIN_WINDOW_MS);
  const captchaRequired = turnstileEnabled() && failures >= 2;
  if (failures >= SIGNIN_MAX_FAILURES) return { ok: false, needCaptcha: captchaRequired, locked: true };
  if (captchaRequired && !(await verifyTurnstile(captchaToken, ip))) return { ok: false, needCaptcha: true, locked: false };

  const user = await findUserByEmail(e);
  const valid = await verifyPassword(password, user?.passwordHash);
  if (!user || !valid || user.status !== "active") {
    await hit(key);
    await audit(null, "auth.sign_in_failed", "user", user?._id, undefined, { email: e }, undefined).catch(() => {});
    return { ok: false, needCaptcha: turnstileEnabled() && failures + 1 >= 2, locked: failures + 1 >= SIGNIN_MAX_FAILURES };
  }
  await clearHits(key);
  const c = await cols();
  await c.users.updateOne({ _id: user._id }, { $set: { lastSignInAt: new Date() } });
  await audit({ userId: user._id, email: user.email, role: user.role, name: user.name, ip }, "auth.sign_in", "user", user._id);
  return { ok: true, user };
}

export async function changePassword(actor: Actor, current: string, next: string, confirm: string, keepSessionHash?: string) {
  const c = await cols();
  const user = await c.users.findOne({ _id: actor.userId });
  if (!user) throw new NotFoundError();
  if (!(await verifyPassword(current, user.passwordHash))) throw new AppError("Your current password is not correct.", "current");
  if (next !== confirm) throw new AppError("The two new passwords do not match.", "confirm");
  const problem = passwordProblem(next, user.email);
  if (problem) throw new AppError(problem, "password");
  await c.users.updateOne({ _id: user._id }, { $set: { passwordHash: await hashPassword(next), updatedAt: new Date() } });
  await c.sessions.deleteMany({ userId: user._id, ...(keepSessionHash ? { tokenHash: { $ne: keepSessionHash } } : {}) });
  await audit(actor, "user.password_change", "user", user._id);
  await sendEmail({ template: "password_changed", to: [user.email], vars: { client_name: user.name, action_link: appUrl("/sign-in") } }).catch(() => {});
}

export async function updateProfile(actor: Actor, input: { name: string; phone?: string }) {
  const c = await cols();
  const before = await c.users.findOne({ _id: actor.userId });
  const name = input.name.trim();
  if (name.length < 2) throw new AppError("Please enter your name.", "name");
  await c.users.updateOne({ _id: actor.userId }, { $set: { name, phone: input.phone?.trim() || undefined, updatedAt: new Date() } });
  await audit(actor, "user.profile_update", "user", actor.userId, { name: before?.name, phone: before?.phone }, { name, phone: input.phone });
}

// ---------- Admin management (super admin only) ----------

function requireSuper(actor: Actor) {
  if (actor.role !== "super_admin") throw new ForbiddenError("Only the super admin can manage admins.");
}

export async function inviteAdmin(actor: Actor, input: { name: string; email: string }) {
  requireSuper(actor);
  const user = await createUser({ name: input.name, email: input.email, role: "admin" });
  await audit(actor, "admin.invite", "user", user._id, undefined, { email: user.email, role: "admin" });
  await inviteAndEmail(user);
  return user;
}

export async function setUserStatus(actor: Actor, userId: ObjectId, status: "active" | "deactivated") {
  const c = await cols();
  const target = await c.users.findOne({ _id: userId });
  if (!target) throw new NotFoundError();
  if (target.role !== "client") requireSuper(actor);
  else if (actor.role === "client") throw new ForbiddenError();
  if (status === "deactivated") assertMayModify(target, "deactivate");
  if (status === "active" && !target.passwordHash) throw new AppError("This user has not set a password yet. Resend the invitation instead.");
  await c.users.updateOne({ _id: userId }, { $set: { status, updatedAt: new Date() } });
  if (status === "deactivated") await c.sessions.deleteMany({ userId });
  await audit(actor, status === "deactivated" ? "user.deactivate" : "user.reactivate", "user", userId, { status: target.status }, { status });
}

/** Removes an admin's access. Admin users are kept (deactivated, role cleared) for the audit trail. */
export async function removeAdmin(actor: Actor, userId: ObjectId) {
  requireSuper(actor);
  const c = await cols();
  const target = await c.users.findOne({ _id: userId });
  if (!target) throw new NotFoundError();
  assertMayModify(target, "remove");
  if (target.role !== "admin") throw new AppError("This user is not an admin.");
  await c.users.updateOne({ _id: userId }, { $set: { status: "deactivated", role: "client", updatedAt: new Date() } });
  await c.sessions.deleteMany({ userId });
  await c.authTokens.updateMany({ userId, usedAt: { $exists: false } }, { $set: { usedAt: new Date() } });
  await audit(actor, "admin.remove", "user", userId, { role: target.role, status: target.status }, { role: "client", status: "deactivated" });
}

export async function changeRole(actor: Actor, userId: ObjectId, role: Role) {
  requireSuper(actor);
  const c = await cols();
  const target = await c.users.findOne({ _id: userId });
  if (!target) throw new NotFoundError();
  assertMayModify(target, "role");
  if (role === "super_admin") throw new ForbiddenError("There can only be one super admin.");
  await c.users.updateOne({ _id: userId }, { $set: { role, updatedAt: new Date() } });
  await c.sessions.deleteMany({ userId });
  await audit(actor, "user.role_change", "user", userId, { role: target.role }, { role });
}

export async function changeEmail(actor: Actor, userId: ObjectId, email: string) {
  const c = await cols();
  const target = await c.users.findOne({ _id: userId });
  if (!target) throw new NotFoundError();
  assertMayModify(target, "email");
  if (target.role !== "client") requireSuper(actor);
  const e = normaliseEmail(email);
  if (await c.users.findOne({ email: e, _id: { $ne: userId } })) throw new AppError("Another user already uses this email.", "email");
  await c.users.updateOne({ _id: userId }, { $set: { email: e, updatedAt: new Date() } });
  await audit(actor, "user.email_change", "user", userId, { email: target.email }, { email: e });
}

export async function resendInvitation(actor: Actor, userId: ObjectId) {
  const c = await cols();
  const target = await c.users.findOne({ _id: userId });
  if (!target) throw new NotFoundError();
  if (target.role !== "client") requireSuper(actor);
  if (target.status === "active") throw new AppError("This user has already activated their account.");
  if (target.status === "deactivated") await c.users.updateOne({ _id: userId }, { $set: { status: "invited" } });
  await inviteAndEmail({ ...target, status: "invited" });
  await audit(actor, "user.invite_resend", "user", userId);
}

export async function cancelInvitation(actor: Actor, userId: ObjectId) {
  const c = await cols();
  const target = await c.users.findOne({ _id: userId });
  if (!target) throw new NotFoundError();
  if (target.role !== "client") requireSuper(actor);
  assertMayModify(target, "deactivate");
  if (target.status !== "invited") throw new AppError("Only pending invitations can be cancelled.");
  await c.authTokens.updateMany({ userId, usedAt: { $exists: false } }, { $set: { usedAt: new Date() } });
  await c.users.updateOne({ _id: userId }, { $set: { status: "deactivated", updatedAt: new Date() } });
  await audit(actor, "user.invite_cancel", "user", userId);
}

export async function signOutEverywhere(actor: Actor) {
  const c = await cols();
  await c.sessions.deleteMany({ userId: actor.userId });
  await audit(actor, "auth.sign_out_all", "user", actor.userId);
}
