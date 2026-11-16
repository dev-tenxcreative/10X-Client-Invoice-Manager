import { ObjectId } from "mongodb";
import { withRequestDb, cols } from "@/lib/db";
import { apiScope, canSeeCompany, notFoundResponse, pdfResponse, unauthorized } from "@/lib/auth/api";
import { invoicePdfBytes, markViewed } from "@/lib/services/invoices";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestDb(async () => {
    const scope = await apiScope();
    if (!scope) return unauthorized();
    const { id } = await params;
    if (!ObjectId.isValid(id)) return notFoundResponse();
    const c = await cols();
    const inv = await c.invoices.findOne({ _id: new ObjectId(id) });
    if (!inv || !canSeeCompany(scope, inv.companyId) || (!scope.isAdmin && inv.status === "draft")) return notFoundResponse();
    try {
      const { bytes, filename } = await invoicePdfBytes(inv);
      if (!scope.isAdmin) await markViewed(inv._id);
      return pdfResponse(bytes, filename, new URL(req.url).searchParams.get("inline") === "1");
    } catch (e) {
      console.error("[pdf] invoice", id, e);
      return new Response("The PDF could not be created right now. Please try again in a minute.", { status: 500 });
    }
  });
}
