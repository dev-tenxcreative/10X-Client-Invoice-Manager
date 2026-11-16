import type { ClientSession, ObjectId } from "mongodb";
import { cols } from "../db";
import type { Role } from "../types";

export interface Actor {
  userId: ObjectId;
  email: string;
  role: Role;
  name: string;
  ip?: string;
}

export const SYSTEM_ACTOR_EMAIL = "system";

function strip(v: unknown): unknown {
  if (!v || typeof v !== "object") return v;
  const o = { ...(v as Record<string, unknown>) };
  delete o.passwordHash;
  delete o.html;
  return o;
}

/** Append-only audit trail. There is no update or delete path for audit logs. */
export async function audit(
  actor: Actor | null,
  action: string,
  entityType: string,
  entityId?: ObjectId | string,
  before?: unknown,
  after?: unknown,
  session?: ClientSession,
): Promise<void> {
  const c = await cols();
  await c.auditLogs.insertOne(
    {
      actorId: actor?.userId,
      actorEmail: actor?.email ?? SYSTEM_ACTOR_EMAIL,
      action,
      entityType,
      entityId,
      before: strip(before),
      after: strip(after),
      ip: actor?.ip,
      at: new Date(),
    } as never,
    { session },
  );
}
