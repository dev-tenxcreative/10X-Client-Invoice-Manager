import { ObjectId } from "mongodb";
import { withRequestDb, cols } from "@/lib/db";
import { apiScope, canSeeCompany, notFoundResponse, unauthorized } from "@/lib/auth/api";
import { readFile } from "@/lib/storage";

/** Authenticated download. Checks permission, then streams the private R2 object. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestDb(async () => {
    const scope = await apiScope();
    if (!scope) return unauthorized();
    const { id } = await params;
    if (!ObjectId.isValid(id)) return notFoundResponse();
    const c = await cols();
    const file = await c.files.findOne({ _id: new ObjectId(id) });
    if (!file) return notFoundResponse();

    if (!scope.isAdmin) {
      if (file.kind === "test") return notFoundResponse();
      if (file.kind !== "logo" && !canSeeCompany(scope, file.companyId)) return notFoundResponse();
      // Documents still in draft are not visible to clients.
      if ((file.kind === "invoice_upload" || file.kind === "invoice_pdf") && file.relatedId) {
        const inv = await c.invoices.findOne({ _id: file.relatedId }, { projection: { status: 1, companyId: 1 } });
        if (!inv || inv.status === "draft" || !canSeeCompany(scope, inv.companyId)) return notFoundResponse();
      }
      if ((file.kind === "proposal_upload" || file.kind === "proposal_pdf" || file.kind === "proposal_signed") && file.relatedId) {
        const p = await c.proposals.findOne({ _id: file.relatedId }, { projection: { status: 1, companyId: 1 } });
        if (!p || p.status === "draft" || !canSeeCompany(scope, p.companyId)) return notFoundResponse();
      }
    }

    try {
      const bytes = await readFile(file);
      const inline = new URL(req.url).searchParams.get("inline") === "1" || file.contentType.startsWith("image/");
      return new Response(bytes as unknown as BodyInit, {
        headers: {
          "Content-Type": file.contentType,
          "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${file.originalName.replace(/"/g, "")}"`,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
        },
      });
    } catch (e) {
      console.error("[files] read failed", id, e);
      return new Response("This file could not be loaded. Please try again later.", { status: 500 });
    }
  });
}
