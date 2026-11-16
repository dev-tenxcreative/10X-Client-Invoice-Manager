import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

/*
 * pdf-lib fallback used only when the Browser Run binding is unavailable (for example in
 * `next dev`). It draws a simplified version of the same document from structured blocks:
 * A4, 16 mm margins, selectable text, "Page x of y" on every page.
 */

export type Block =
  | { type: "header"; title: string; meta: [string, string][]; badge?: string; subtitle?: string }
  | { type: "columns"; cols: { label: string; title?: string; lines: string[] }[] }
  | { type: "heading"; text: string }
  | { type: "para"; text: string; bold?: boolean; muted?: boolean; size?: number }
  | { type: "table"; columns: { label: string; width: number; align?: "left" | "right" }[]; rows: { cells: string[]; sub?: string[] }[] }
  | { type: "totals"; rows: { label: string; value: string; strong?: boolean }[] }
  | { type: "kv"; rows: [string, string][] }
  | { type: "stamp"; text: string; sub?: string }
  | { type: "pagebreak" }
  | { type: "spacer"; h: number };

const MM = 72 / 25.4;
const A4 = { w: 210 * MM, h: 297 * MM };
const M = { top: 18 * MM, bottom: 20 * MM, left: 16 * MM, right: 16 * MM };
const RED = rgb(0xd7 / 255, 0x19 / 255, 0x20 / 255);
const INK = rgb(0x1f / 255, 0x21 / 255, 0x28 / 255);
const MUTED = rgb(0x6b / 255, 0x72 / 255, 0x80 / 255);
const LINE = rgb(0.9, 0.9, 0.92);

/** Keeps characters the standard (WinAnsi) fonts can encode. */
function clean(s: string): string {
  return (s ?? "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/ /g, " ")
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF•]/g, "?");
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of clean(text).split("\n")) {
    const words = para.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      out.push("");
      continue;
    }
    let line = "";
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(test, size) <= width) line = test;
      else {
        if (line) out.push(line);
        // Hard-break very long words.
        let rest = w;
        while (font.widthOfTextAtSize(rest, size) > width && rest.length > 1) {
          let i = rest.length;
          while (i > 1 && font.widthOfTextAtSize(rest.slice(0, i), size) > width) i--;
          out.push(rest.slice(0, i));
          rest = rest.slice(i);
        }
        line = rest;
      }
    }
    out.push(line);
  }
  return out;
}

export async function renderBlocksPdf(blocks: Block[], opts: { footer: string; headerLine?: string; title: string }): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(clean(opts.title));
  pdf.setCreator("10X Creative Client Portal");
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const contentW = A4.w - M.left - M.right;

  let page: PDFPage = pdf.addPage([A4.w, A4.h]);
  let y = A4.h - M.top;

  const newPage = () => {
    page = pdf.addPage([A4.w, A4.h]);
    y = A4.h - M.top;
    if (opts.headerLine) {
      page.drawText(clean(opts.headerLine), { x: M.left, y: A4.h - 10 * MM, size: 7.5, font: regular, color: MUTED });
    }
  };
  const ensure = (h: number) => {
    if (y - h < M.bottom) newPage();
  };
  const text = (s: string, x: number, size: number, f: PDFFont, color = INK) => page.drawText(clean(s), { x, y, size, font: f, color });

  // Top brand bar on first page.
  page.drawRectangle({ x: M.left, y: A4.h - M.top + 6, width: contentW, height: 3, color: RED });
  y -= 8;

  for (const b of blocks) {
    switch (b.type) {
      case "header": {
        ensure(90);
        // Logo wordmark
        text("10X", M.left, 30, bold, RED);
        page.drawText("Creative", { x: M.left + bold.widthOfTextAtSize("10X", 30) + 6, y: y + 2, size: 14, font: bold, color: INK });
        const titleW = bold.widthOfTextAtSize(clean(b.title), 20);
        page.drawText(clean(b.title), { x: A4.w - M.right - titleW, y, size: 20, font: bold, color: INK });
        let my = y - 18;
        for (const [k, v] of b.meta) {
          const s = `${k}: ${v}`;
          const w = regular.widthOfTextAtSize(clean(s), 9);
          page.drawText(clean(s), { x: A4.w - M.right - w, y: my, size: 9, font: regular, color: INK });
          my -= 12;
        }
        if (b.badge) {
          const w = bold.widthOfTextAtSize(clean(b.badge), 9);
          page.drawText(clean(b.badge), { x: A4.w - M.right - w, y: my - 2, size: 9, font: bold, color: RED });
          my -= 14;
        }
        if (b.subtitle) page.drawText(clean(b.subtitle), { x: M.left, y: y - 16, size: 8, font: regular, color: MUTED });
        y = Math.min(my, y - 30) - 14;
        break;
      }
      case "columns": {
        const colW = contentW / b.cols.length - 10;
        const heights = b.cols.map((c) => 12 + (c.title ? 13 : 0) + c.lines.reduce((h, l) => h + wrap(l, regular, 9, colW).length * 11.5, 0));
        const h = Math.max(...heights);
        ensure(h);
        const top = y;
        b.cols.forEach((c, i) => {
          const x = M.left + i * (colW + 10);
          y = top;
          text(c.label.toUpperCase(), x, 7.5, bold, RED);
          y -= 12;
          if (c.title) {
            text(c.title, x, 10, bold);
            y -= 13;
          }
          for (const l of c.lines) for (const w of wrap(l, regular, 9, colW)) {
            text(w, x, 9, regular, MUTED);
            y -= 11.5;
          }
        });
        y = top - h - 10;
        break;
      }
      case "heading": {
        ensure(30);
        y -= 6;
        text(b.text, M.left, 12, bold);
        y -= 6;
        page.drawLine({ start: { x: M.left, y }, end: { x: M.left + 40, y }, thickness: 1.5, color: RED });
        y -= 14;
        break;
      }
      case "para": {
        const size = b.size ?? 9.5;
        const f = b.bold ? bold : regular;
        for (const l of wrap(b.text, f, size, contentW)) {
          ensure(size + 4);
          text(l, M.left, size, f, b.muted ? MUTED : INK);
          y -= size + 3.5;
        }
        y -= 4;
        break;
      }
      case "kv": {
        for (const [k, v] of b.rows) {
          ensure(13);
          text(k, M.left, 9, regular, MUTED);
          text(v, M.left + 110, 9, bold);
          y -= 12.5;
        }
        y -= 4;
        break;
      }
      case "table": {
        const totalW = b.columns.reduce((s, c) => s + c.width, 0);
        const widths = b.columns.map((c) => (c.width / totalW) * contentW);
        const drawHead = () => {
          ensure(20);
          let x = M.left;
          b.columns.forEach((c, i) => {
            const label = c.label.toUpperCase();
            const w = bold.widthOfTextAtSize(label, 7.5);
            page.drawText(label, { x: c.align === "right" ? x + widths[i] - w - 4 : x + 4, y, size: 7.5, font: bold, color: MUTED });
            x += widths[i];
          });
          y -= 6;
          page.drawLine({ start: { x: M.left, y }, end: { x: M.left + contentW, y }, thickness: 1.2, color: INK });
          y -= 12;
        };
        drawHead();
        for (const row of b.rows) {
          const cellLines = row.cells.map((cell, i) => wrap(cell, i === 1 || (b.columns.length === 2 && i === 0) ? bold : regular, 9, widths[i] - 8));
          const subLines = (row.sub ?? []).flatMap((s) => wrap(s, regular, 8.5, widths[1] - 8));
          const h = Math.max(...cellLines.map((l) => l.length)) * 11.5 + subLines.length * 10.5 + 8;
          if (y - h < M.bottom) {
            newPage();
            drawHead();
          }
          const top = y;
          let x = M.left;
          b.columns.forEach((c, i) => {
            let ly = top;
            const f = i === 1 || (b.columns.length === 2 && i === 0) ? bold : regular;
            for (const l of cellLines[i]) {
              const w = f.widthOfTextAtSize(l, 9);
              page.drawText(l, { x: c.align === "right" ? x + widths[i] - w - 4 : x + 4, y: ly, size: 9, font: f, color: INK });
              ly -= 11.5;
            }
            if (i === 1) for (const s of subLines) {
              page.drawText(s, { x: x + 4, y: ly, size: 8.5, font: regular, color: MUTED });
              ly -= 10.5;
            }
            x += widths[i];
          });
          y = top - h + 4;
          page.drawLine({ start: { x: M.left, y: y + 2 }, end: { x: M.left + contentW, y: y + 2 }, thickness: 0.5, color: LINE });
          y -= 10;
        }
        y -= 4;
        break;
      }
      case "totals": {
        const boxW = 220;
        const x0 = A4.w - M.right - boxW;
        ensure(b.rows.length * 16 + 10);
        for (const r of b.rows) {
          const size = r.strong ? 13 : 9.5;
          const f = r.strong ? bold : regular;
          if (r.strong) {
            y -= 4;
            page.drawLine({ start: { x: x0, y: y + size + 2 }, end: { x: x0 + boxW, y: y + size + 2 }, thickness: 1.5, color: RED });
          }
          page.drawText(clean(r.label), { x: x0, y, size: r.strong ? 10.5 : size, font: f, color: INK });
          const w = f.widthOfTextAtSize(clean(r.value), size);
          page.drawText(clean(r.value), { x: x0 + boxW - w, y, size, font: f, color: r.strong ? RED : INK });
          y -= size + 6;
        }
        y -= 6;
        break;
      }
      case "stamp": {
        const p = pdf.getPage(0);
        p.drawText(clean(b.text), { x: A4.w - M.right - 150, y: A4.h - 140, size: 30, font: bold, color: rgb(0.02, 0.59, 0.41), opacity: 0.8 });
        if (b.sub) p.drawText(clean(b.sub), { x: A4.w - M.right - 146, y: A4.h - 154, size: 9, font: bold, color: rgb(0.02, 0.59, 0.41), opacity: 0.8 });
        break;
      }
      case "pagebreak":
        newPage();
        break;
      case "spacer":
        y -= b.h;
        break;
    }
  }

  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    const label = `Page ${i + 1} of ${pages.length}`;
    p.drawLine({ start: { x: M.left, y: M.bottom - 8 }, end: { x: A4.w - M.right, y: M.bottom - 8 }, thickness: 0.5, color: LINE });
    p.drawText(clean(opts.footer), { x: M.left, y: M.bottom - 20, size: 7, font: regular, color: MUTED });
    const w = regular.widthOfTextAtSize(label, 7.5);
    p.drawText(label, { x: A4.w - M.right - w, y: M.bottom - 20, size: 7.5, font: regular, color: MUTED });
  });

  return pdf.save();
}
