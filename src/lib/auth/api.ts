import type { ObjectId } from "mongodb";
import { cols } from "../db";
import { getAuth, type Auth } from "./session";
import { isAdminRole } from "../permissions";

export interface ApiScope {
  auth: Auth;
  isAdmin: boolean;
  /** For clients: the companies they belong to (from the database, never from the request). */
  companyIds: ObjectId[];
}

export async function apiScope(): Promise<ApiScope | null> {
  const auth = await getAuth();
  if (!auth) return null;
  if (isAdminRole(auth.user.role)) return { auth, isAdmin: true, companyIds: [] };
  const c = await cols();
  const ms = await c.memberships.find({ userId: auth.user._id }).toArray();
  return { auth, isAdmin: false, companyIds: ms.map((m) => m.companyId) };
}

export function canSeeCompany(scope: ApiScope, companyId?: ObjectId | null): boolean {
  if (scope.isAdmin) return true;
  return Boolean(companyId && scope.companyIds.some((id) => id.equals(companyId)));
}

export function pdfResponse(bytes: Uint8Array, filename: string, inline = false): Response {
  return new Response(bytes as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${filename.replace(/"/g, "")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export const notFoundResponse = () => new Response("Not found", { status: 404 });
export const unauthorized = () => new Response("Please sign in", { status: 401 });
