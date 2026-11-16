import { escapeHtml } from "../text";
import type { EmailTemplate } from "../types";

export type EmailVars = Record<string, string | number | undefined | null>;

export function fillText(template: string, vars: EmailVars): string {
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, k: string) => {
    const v = vars[k];
    return v === undefined || v === null ? "" : String(v);
  });
}

function fillHtml(template: string, vars: EmailVars): string {
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, k: string) => {
    const v = vars[k];
    return v === undefined || v === null ? "" : escapeHtml(String(v));
  });
}

/** Collapses empty paragraphs left by empty variables. */
function paragraphs(text: string): string[] {
  return text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function renderEmail(
  tpl: EmailTemplate,
  vars: EmailVars,
  brand: { legalName: string; address: string; phone: string; website: string; email: string },
): RenderedEmail {
  const subject = fillText(tpl.subject, vars).replace(/\s+/g, " ").trim();
  const bodyText = fillText(tpl.body, vars);
  const link = vars.action_link ? String(vars.action_link) : "";

  const htmlParas = paragraphs(tpl.body)
    .map((p) => fillHtml(p, vars).trim())
    .filter(Boolean)
    .map((p) => `<p style="margin:0 0 16px;line-height:1.6">${p.replace(/\n/g, "<br>")}</p>`)
    .join("");

  const button = link && tpl.buttonLabel
    ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:8px 0 24px"><tr><td style="border-radius:6px;background:#d71920">
        <a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 22px;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px">${escapeHtml(tpl.buttonLabel)}</a>
      </td></tr></table>
      <p style="margin:0 0 16px;font-size:12px;color:#6b7280;line-height:1.5">If the button does not work, copy this link into your browser:<br><a href="${escapeHtml(link)}" style="color:#d71920;word-break:break-all">${escapeHtml(link)}</a></p>`
    : "";

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#18181b">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f4f5;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e4e4e7">
<tr><td style="height:4px;background:#d71920;font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td style="padding:24px 28px 8px"><span style="font-size:24px;font-weight:800;color:#d71920;letter-spacing:-0.5px">10X</span><span style="font-size:18px;font-weight:700;color:#1f2128;margin-left:6px">Creative</span></td></tr>
<tr><td style="padding:16px 28px 8px;font-size:15px">${htmlParas}${button}</td></tr>
<tr><td style="padding:16px 28px 24px;border-top:1px solid #e4e4e7;font-size:12px;color:#6b7280;line-height:1.6">
${escapeHtml(brand.legalName)}<br>${escapeHtml(brand.address)}<br>${escapeHtml([brand.phone, brand.email, brand.website].filter(Boolean).join(" · "))}
</td></tr></table></td></tr></table></body></html>`;

  const text = [
    paragraphs(bodyText).join("\n\n"),
    link && tpl.buttonLabel ? `${tpl.buttonLabel}: ${link}` : "",
    "--",
    brand.legalName,
    brand.address,
    [brand.phone, brand.email, brand.website].filter(Boolean).join(" | "),
  ].filter(Boolean).join("\n\n");

  return { subject, html, text };
}
