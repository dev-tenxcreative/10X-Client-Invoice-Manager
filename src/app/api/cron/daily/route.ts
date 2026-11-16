import { timingSafeEqual } from "node:crypto";
import { withRequestDb } from "@/lib/db";
import { env } from "@/lib/env";
import { runDailyJob } from "@/lib/services/jobs";

function authorised(req: Request): boolean {
  const header = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${env("CRON_SECRET")}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Called by the Cron Trigger (custom-worker.ts) once a day, or manually with the secret. */
export async function POST(req: Request) {
  if (!authorised(req)) return new Response("Unauthorized", { status: 401 });
  const result = await withRequestDb(() => runDailyJob());
  return Response.json(result);
}
