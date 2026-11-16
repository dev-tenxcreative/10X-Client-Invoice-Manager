import type { ObjectId } from "mongodb";
import type { Role } from "./types";

export function isAdminRole(role: Role): boolean {
  return role === "admin" || role === "super_admin";
}

export function isSuperAdmin(role: Role): boolean {
  return role === "super_admin";
}

export interface CompanyScope {
  companyIds: ObjectId[];
}

/** A client may only see records of companies they belong to. */
export function canAccessCompany(scope: CompanyScope, companyId: ObjectId | undefined | null): boolean {
  if (!companyId) return false;
  return scope.companyIds.some((id) => id.equals(companyId));
}
