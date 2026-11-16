import { getCloudflareContext } from "@opennextjs/cloudflare";
import { renderBlocksPdf, type Block } from "./fallback";
import { escapeHtml } from "../text";

export type PdfEngine = "browser-run" | "pdf-lib";

interface BrowserBinding {
  fetch: unknown;
}

async function browserBinding(): Promise<BrowserBinding | null> {
  try {
    const { env } = await getCloudflareContext({ async: true });
    return ((env as unknown as { BROWSER?: BrowserBinding }).BROWSER) ?? null;
  } catch {
    return null;
  }
}

/**
 * Renders a document to PDF. Primary path: Cloudflare Browser Run + @cloudflare/puppeteer,
 * from the same HTML used on screen. Fallback (no binding, e.g. local dev): pdf-lib blocks.
 */
export async function renderPdf(input: {
  html: string;
  blocks: Block[];
  title: string;
  footerLeft: string;
  headerLine?: string;
}): Promise<{ bytes: Uint8Array; engine: PdfEngine }> {
  const binding = await browserBinding();
  if (binding && process.env.PDF_ENGINE !== "pdf-lib") {
    try {
      const puppeteer = (await import("@cloudflare/puppeteer")).default;
      const browser = await puppeteer.launch(binding as never);
      try {
        const page = await browser.newPage();
        await page.setContent(input.html, { waitUntil: "load" });
        await page.evaluate(() => document.fonts.ready.then(() => true));
        const footer = `<div style="width:100%;font-family:Arial,sans-serif;font-size:7.5px;color:#6B7280;padding:0 16mm;display:flex;justify-content:space-between">
          <span>${escapeHtml(input.footerLeft)}</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`;
        const header = input.headerLine
          ? `<div style="width:100%;font-family:Arial,sans-serif;font-size:7.5px;color:#6B7280;padding:0 16mm">${escapeHtml(input.headerLine)}</div>`
          : "<span></span>";
        const bytes = await page.pdf({
          format: "A4",
          printBackground: true,
          displayHeaderFooter: true,
          headerTemplate: header,
          footerTemplate: footer,
          margin: { top: "18mm", bottom: "20mm", left: "16mm", right: "16mm" },
          preferCSSPageSize: false,
        });
        return { bytes: new Uint8Array(bytes), engine: "browser-run" };
      } finally {
        await browser.close();
      }
    } catch (e) {
      console.error("[pdf] Browser Run failed, using pdf-lib fallback", e);
    }
  }
  const bytes = await renderBlocksPdf(input.blocks, { footer: input.footerLeft, headerLine: input.headerLine, title: input.title });
  return { bytes, engine: "pdf-lib" };
}
