import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { ObjectId } from "mongodb";
import { cols } from "../db";
import { appUrl } from "../env";
import { randomToken, sha256 } from "./crypto";
import { isAdminRole } from "../permissions";
import type { Actor } from "../services/audit";
import type { CompanyDoc, UserDoc } from "../types";

export const SESSION_COOKIE = "tenx_session";
export const COMPANY_COOKIE = "tenx_company";
export const VIEW_AS_COOKIE = "tenx_view_as";

const ADMIN_TTL_MS = 12 * 60 * 60 * 1000; // fixed 12 hours
const CLIENT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days, rolling
const ROLL_EVERY_MS = 10 * 60 * 1000;

function secureCookies(): boolean {
  return appUrl().startsWith("https://") || process.env.NODE_ENV === "production";
}

export async function requestMeta(): Promise<{ ip: string; userAgent: string }> {
  const h = await headers();
  const ip = h.get("cf-connecting-ip") || h.get("x-real-ip") || h.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  return { ip, userAgent: (h.get("user-agent") || "").slice(0, 300) };
}

export async function createSession(user: UserDoc): Promise<void> {
  const c = await cols();
  const { ip, userAgent } = await requestMeta();
  const raw = randomToken(32);
  const ttl = isAdminRole(user.role) ? ADMIN_TTL_MS : CLIENT_TTL_MS;
  const now = new Date();
  await c.sessions.insertOne({
    _id: new ObjectId(),
    tokenHash: sha256(raw),
    userId: user._id,
    role: user.role,
    expiresAt: new Date(now.getTime() + ttl),
    createdAt: now,
    lastSeenAt: now,
    ip,
    userAgent,
  });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, raw, {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: "lax",
    path: "/",
    // Clients: the cookie outlives the rolling 7-day DB session; the DB decides validity.
    maxAge: isAdminRole(user.role) ? ADMIN_TTL_MS / 1000 : 30 * 24 * 60 * 60,
  });
  jar.delete(VIEW_AS_COOKIE);
}

export interface Auth {
  user: UserDoc;
  sessionHash: string;
  actor: Actor;
}

/** Current signed-in user, or null. Memoised per request. */
export const getAuth = cache(async (): Promise<Auth | null> => {
  const jar = await cookies();
  const raw = jar.get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  const c = await cols();
  const tokenHash = sha256(raw);
  const session = await c.sessions.findOne({ tokenHash });
  if (!session || session.expiresAt < new Date()) return null;
  const user = await c.users.findOne({ _id: session.userId });
  if (!user || user.status !== "active" || user.role !== session.role) {
    await c.sessions.deleteOne({ _id: session._id });
    return null;
  }
  const now = Date.now();
  if (!isAdminRole(user.role) && now - session.lastSeenAt.getTime() > ROLL_EVERY_MS) {
    await c.sessions.updateOne({ _id: session._id }, { $set: { lastSeenAt: new Date(now), expiresAt: new Date(now + CLIENT_TTL_MS) } });
  }
  const { ip } = await requestMeta();
  return {
    user,
    sessionHash: tokenHash,
    actor: { userId: user._id, email: user.email, role: user.role, name: user.name, ip },
  };
});

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const raw = jar.get(SESSION_COOKIE)?.value;
  if (raw) {
    const c = await cols();
    await c.sessions.deleteOne({ tokenHash: sha256(raw) });
  }
  jar.delete(SESSION_COOKIE);
  jar.delete(VIEW_AS_COOKIE);
  jar.delete(COMPANY_COOKIE);
}

export async function requireUser(): Promise<Auth> {
  const auth = await getAuth();
  if (!auth) redirect("/sign-in");
  return auth;
}

export async function requireAdmin(): Promise<Auth> {
  const auth = await requireUser();
  if (!isAdminRole(auth.user.role)) redirect("/portal");
  return auth;
}

export async function requireSuperAdmin(): Promise<Auth> {
  const auth = await requireAdmin();
  if (auth.user.role !== "super_admin") redirect("/admin");
  return auth;
}

export interface PortalContext {
  auth: Auth;
  companies: CompanyDoc[];
  companyIds: ObjectId[];
  company: CompanyDoc;
  /** True when an admin is previewing the portal as a company ("View as client"). */
  readOnly: boolean;
}

/**
 * Everything a client screen may show is scoped by this context. Company IDs come from the
 * user's memberships on the server, never from the browser.
 */
export const getPortalContext = cache(async (): Promise<PortalContext> => {
  const auth = await requireUser();
  const c = await cols();
  const jar = await cookies();

  if (isAdminRole(auth.user.role)) {
    const viewAs = jar.get(VIEW_AS_COOKIE)?.value;
    if (!viewAs || !ObjectId.isValid(viewAs)) redirect("/admin");
    const company = await c.companies.findOne({ _id: new ObjectId(viewAs) });
    if (!company) redirect("/admin");
    return { auth, companies: [company], companyIds: [company._id], company, readOnly: true };
  }

  const memberships = await c.memberships.find({ userId: auth.user._id }).toArray();
  const companies = await c.companies
    .find({ _id: { $in: memberships.map((m) => m.companyId) } })
    .sort({ name: 1 })
    .toArray();
  if (companies.length === 0) redirect("/no-access");
  const wanted = jar.get(COMPANY_COOKIE)?.value;
  const company = companies.find((co) => co._id.toHexString() === wanted) ?? companies[0];
  return { auth, companies, companyIds: companies.map((co) => co._id), company, readOnly: false };
});

/** Use in portal mutations: blocks admins previewing as a client. */
export async function requireWritablePortal(): Promise<PortalContext> {
  const ctx = await getPortalContext();
  if (ctx.readOnly) throw new Error("Read-only preview");
  return ctx;
}
