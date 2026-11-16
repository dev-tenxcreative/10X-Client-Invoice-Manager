import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { canAccessCompany, isAdminRole, isSuperAdmin } from "@/lib/permissions";
import { displayStatus, isOverdue, statusAfterPayment } from "@/lib/invoice-status";
import { escapeHtml, richTextToHtml } from "@/lib/text";
import { sniffType } from "@/lib/storage";
import { passwordProblem } from "@/lib/auth/password-policy";

describe("roles and company scope", () => {
  const a = new ObjectId();
  const b = new ObjectId();
  it("lets a client see only their own companies", () => {
    expect(canAccessCompany({ companyIds: [a] }, a)).toBe(true);
    expect(canAccessCompany({ companyIds: [a] }, b)).toBe(false);
    expect(canAccessCompany({ companyIds: [] }, a)).toBe(false);
    expect(canAccessCompany({ companyIds: [a] }, null)).toBe(false);
  });
  it("knows admin roles", () => {
    expect(isAdminRole("super_admin")).toBe(true);
    expect(isAdminRole("admin")).toBe(true);
    expect(isAdminRole("client")).toBe(false);
    expect(isSuperAdmin("admin")).toBe(false);
  });
});

describe("invoice status", () => {
  it("derives overdue only for unpaid open invoices past the due date", () => {
    expect(isOverdue({ status: "sent", dueDate: "2026-11-15", balance: 100 }, "2026-11-16")).toBe(true);
    expect(isOverdue({ status: "sent", dueDate: "2026-11-16", balance: 100 }, "2026-11-16")).toBe(false);
    expect(isOverdue({ status: "paid", dueDate: "2026-11-01", balance: 0 }, "2026-11-16")).toBe(false);
    expect(isOverdue({ status: "draft", dueDate: "2026-11-01", balance: 100 }, "2026-11-16")).toBe(false);
    expect(isOverdue({ status: "void", dueDate: "2026-11-01", balance: 100 }, "2026-11-16")).toBe(false);
    expect(displayStatus({ status: "partially_paid", dueDate: "2026-11-01", balance: 50 }, "2026-11-16")).toBe("overdue");
  });
  it("moves through partial to paid", () => {
    expect(statusAfterPayment({ status: "sent", total: 1000 }, 400)).toBe("partially_paid");
    expect(statusAfterPayment({ status: "partially_paid", total: 1000 }, 1000)).toBe("paid");
    expect(statusAfterPayment({ status: "void", total: 1000 }, 1000)).toBe("void");
  });
});

describe("safety helpers", () => {
  it("escapes HTML", () => {
    expect(escapeHtml(`<script>"x"&'y'</script>`)).toBe("&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/script&gt;");
  });
  it("allows only bold, lists and safe links in rich text", () => {
    const html = richTextToHtml("**Hi** <img src=x onerror=alert(1)>\n- one\n[ok](https://a.b) [bad](javascript:alert(1))");
    expect(html).toContain("<strong>Hi</strong>");
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<img");
    expect(html).toContain('<a href="https://a.b">ok</a>');
    expect(html).not.toContain('href="javascript');
    expect(html).toContain("<li>one</li>");
  });
  it("detects file types by signature, not by name", () => {
    expect(sniffType(new TextEncoder().encode("%PDF-1.7 ..."))).toBe("application/pdf");
    expect(sniffType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(sniffType(new TextEncoder().encode("<html>"))).toBeNull();
    expect(sniffType(new TextEncoder().encode("MZ\x90\x00"))).toBeNull();
  });
  it("enforces the password policy", () => {
    expect(passwordProblem("short")).toMatch(/10 characters/);
    expect(passwordProblem("password123")).toMatch(/common/);
    expect(passwordProblem("nimal.perera2026", "nimal.perera@x.com")).toMatch(/email/);
    expect(passwordProblem("blue-river-sunset-42")).toBeNull();
  });
});
