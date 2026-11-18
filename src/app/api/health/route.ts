import { timingSafeEqual } from "node:crypto";
import { ObjectId } from "mongodb";
import { cols, withRequestDb } from "@/lib/db";
import { env } from "@/lib/env";
import { readFile, storeFile } from "@/lib/storage";
import { renderPdf } from "@/lib/pdf/render";
import { sendEmail } from "@/lib/email";
import { hashPassword, verifyPassword } from "@/lib/auth/crypto";

/**
 * Platform proof (build phase 1). GET with "Authorization: Bearer CRON_SECRET".
 * ?email=you@example.com also sends one test email.
 * Checks MongoDB read/write, R2 upload/download, PDF rendering and password hashing time.
 */
export async function GET(req: Request) {
  const header = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${env("CRON_SECRET")}`;
  if (header.length !== expected.length || !timingSafeEqual(Buffer.from(header), Buffer.from(expected))) {
    return Response.json({ ok: true });
  }
  return withRequestDb(async () => {
    const out: Record<string, unknown> = {};
    const time = async (name: string, fn: () => Promise<unknown>) => {
      const t = Date.now();
      try {
        out[name] = { ok: true, ms: Date.now() - t, result: await fn() };
        (out[name] as { ms: number }).ms = Date.now() - t;
      } catch (e) {
        out[name] = { ok: false, ms: Date.now() - t, error: e instanceof Error ? e.message : String(e) };
      }
    };
    await time("mongodb", async () => {
      const c = await cols();
      const _id = `health-${new ObjectId().toHexString()}`;
      await c.jobRuns.insertOne({ _id, at: new Date() });
      const back = await c.jobRuns.findOne({ _id });
      await c.jobRuns.deleteOne({ _id });
      return Boolean(back);
    });
    await time("passwordHash", async () => {
      const h = await hashPassword("health-check-password");
      return verifyPassword("health-check-password", h);
    });
    let pdfBytes: Uint8Array | null = null;
    await time("pdf", async () => {
      const r = await renderPdf({ html: "<!doctype html><html><body><h1>10X Creative</h1><p>PDF check</p></body></html>", blocks: [{ type: "para", text: "PDF check" }], title: "Health check", footerLeft: "Health check" });
      pdfBytes = r.bytes;
      return { engine: r.engine, bytes: r.bytes.byteLength };
    });
    await time("r2", async () => {
      const bytes = pdfBytes ?? new TextEncoder().encode("%PDF-1.4\n%health\n");
      const f = await storeFile({ bytes, originalName: "health.pdf", kind: "test" });
      const back = await readFile(f);
      return { stored: f.key, roundTrip: back.byteLength === bytes.byteLength };
    });
    const to = new URL(req.url).searchParams.get("email");
    if (to) {
      await time("email", async () => {
        const log = await sendEmail({ template: "test", to: [to], vars: { client_name: "there", action_link: env("APP_URL", "") } });
        // sendEmail() returns the pre-delivery doc; the failure reason is only on the stored log.
        const stored = await (await cols()).emailLogs.findOne({ _id: log._id }, { projection: { error: 1 } });
        return { status: log.status, error: stored?.error };
      });
    }
    out.runtime = typeof navigator !== "undefined" ? navigator.userAgent : "node";
    return Response.json(out);
  });
}
