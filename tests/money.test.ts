import { describe, expect, it } from "vitest";
import { computeTotals, formatMoney, lineAmount, normaliseItems, parseDecimal, parseQty, parseRateBp, percentOf, splitByMilestones, toMinor } from "@/lib/money";
import { formatNumber } from "@/lib/services/counters";

describe("money parsing", () => {
  it("parses decimals into integer minor units without floats", () => {
    expect(toMinor("65,000.00")).toBe(6500000);
    expect(toMinor("0.1")).toBe(10);
    expect(toMinor("0.29")).toBe(29);
    expect(toMinor("1234.565")).toBe(123457); // half up on the third decimal
    expect(toMinor("19.99", "USD")).toBe(1999);
  });
  it("rejects invalid numbers", () => {
    expect(() => toMinor("abc")).toThrow();
    expect(() => toMinor("1.2.3")).toThrow();
    expect(() => toMinor("")).toThrow();
  });
  it("parses quantities and rates", () => {
    expect(parseQty("1.5")).toBe(150);
    expect(() => parseQty("0")).toThrow();
    expect(parseRateBp("10")).toBe(1000);
    expect(parseRateBp("2.5")).toBe(250);
    expect(() => parseRateBp("101")).toThrow();
  });
  it("formats like LKR 65,000.00", () => {
    expect(formatMoney(6500000, "LKR")).toBe("LKR 65,000.00");
    expect(formatMoney(5, "USD")).toBe("USD 0.05");
    expect(formatMoney(-12345, "USD")).toBe("USD -123.45");
    expect(formatMoney(0, "LKR")).toBe("LKR 0.00");
  });
});

describe("totals", () => {
  it("computes line amounts with half-up rounding", () => {
    expect(lineAmount(150, 333)).toBe(500); // 1.5 x 3.33 = 4.995 -> 5.00
    expect(lineAmount(100, 250000)).toBe(250000);
    expect(lineAmount(33, 100)).toBe(33);
  });
  it("handles very large amounts with BigInt maths", () => {
    // 10,000 units x 9,000,000,000.00 = 90,000,000,000,000.00 (9e15 minor units), exact.
    expect(lineAmount(1000000, 900000000000)).toBe(9000000000000000);
    expect(() => lineAmount(10000000, 900000000000)).toThrow(/too large/);
  });
  it("applies discount before tax", () => {
    const items = normaliseItems([
      { title: "A", qty100: 100, unitPrice: 250000 },
      { title: "B", qty100: 100, unitPrice: 120000 },
    ]);
    const t = computeTotals(items, { type: "none", value: 0 }, { label: "VAT", rateBp: 1000 });
    expect(t).toEqual({ subtotal: 370000, discountTotal: 0, taxTotal: 37000, total: 407000 }); // matches the sample invoice
    const d = computeTotals(items, { type: "percent", value: 1000 }, { label: "VAT", rateBp: 1800 });
    expect(d.discountTotal).toBe(37000);
    expect(d.taxTotal).toBe(59940);
    expect(d.total).toBe(370000 - 37000 + 59940);
  });
  it("blocks discounts above the subtotal", () => {
    const items = normaliseItems([{ title: "A", qty100: 100, unitPrice: 100 }]);
    expect(() => computeTotals(items, { type: "amount", value: 101 }, { label: "", rateBp: 0 })).toThrow();
  });
  it("percentOf rounds half up", () => {
    expect(percentOf(1005, 5000)).toBe(503);
    expect(percentOf(333, 3333)).toBe(111);
  });
  it("splits milestones and puts rounding on the last one", () => {
    expect(splitByMilestones(100001, [{ type: "percent", value: 5000 }, { type: "percent", value: 5000 }])).toEqual([50001, 50000]);
    expect(splitByMilestones(1000, [{ type: "percent", value: 3333 }, { type: "percent", value: 3333 }, { type: "percent", value: 3334 }]).reduce((a, b) => a + b)).toBe(1000);
  });
  it("parseDecimal never returns floats", () => {
    for (const s of ["0.07", "1.10", "123456.78", "0.005"]) expect(Number.isInteger(parseDecimal(s, 2))).toBe(true);
  });
});

describe("numbering", () => {
  it("formats invoice and proposal numbers", () => {
    expect(formatNumber("10X-INV", 2026, 1, 4)).toBe("10X-INV-2026-0001");
    expect(formatNumber("10X-PRO", 2026, 12, 3)).toBe("10X-PRO-2026-012");
    expect(formatNumber("10X-INV", 2026, 12345, 4)).toBe("10X-INV-2026-12345");
  });
});
