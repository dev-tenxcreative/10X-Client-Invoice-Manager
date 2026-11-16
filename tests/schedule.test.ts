import { describe, expect, it } from "vitest";
import { duePeriods, needsFollowUp, nextBillingDate, parseOffsets, pickReminderStep, reminderTemplate } from "@/lib/schedule";
import { addDays, colomboDate, diffDays, formatDate, periodLabel } from "@/lib/dates";

const plan = (over: Partial<Parameters<typeof duePeriods>[0]> = {}) => ({
  status: "active" as const,
  startDate: "2026-09-15",
  billingDay: 1,
  skippedPeriods: [] as string[],
  ...over,
});

describe("time zone", () => {
  it("uses the Colombo calendar date", () => {
    // 20:00 UTC on 15 Nov is 01:30 on 16 Nov in Colombo (UTC+5:30).
    expect(colomboDate(new Date("2026-11-15T20:00:00Z"))).toBe("2026-11-16");
    expect(colomboDate(new Date("2026-11-15T18:00:00Z"))).toBe("2026-11-15");
    // The cron at 02:30 UTC is 08:00 in Colombo, the same date.
    expect(colomboDate(new Date("2026-11-16T02:30:00Z"))).toBe("2026-11-16");
  });
  it("formats dates as 16 Nov 2026", () => {
    expect(formatDate("2026-11-16")).toBe("16 Nov 2026");
    expect(periodLabel("2026-11")).toBe("November 2026");
  });
  it("adds days across month and year ends", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(diffDays("2026-11-30", "2026-12-14")).toBe(14);
  });
});

describe("recurring plans", () => {
  it("creates nothing before the billing day", () => {
    expect(duePeriods(plan({ startDate: "2026-11-01", billingDay: 20 }), "2026-11-19", new Set())).toEqual([]);
  });
  it("creates the invoice on the billing day", () => {
    expect(duePeriods(plan({ startDate: "2026-11-01", billingDay: 20 }), "2026-11-20", new Set())).toEqual(["2026-11"]);
  });
  it("never creates a second invoice for the same month", () => {
    expect(duePeriods(plan({ startDate: "2026-11-01", billingDay: 20 }), "2026-11-25", new Set(["2026-11"]))).toEqual([]);
  });
  it("skips a billing date before the start date", () => {
    // Start 15 Sep with billing day 1: first invoice is 1 Oct.
    expect(duePeriods(plan(), "2026-11-16", new Set())).toEqual(["2026-10", "2026-11"]);
  });
  it("catches up missed months", () => {
    expect(duePeriods(plan(), "2026-11-16", new Set(["2026-10"]))).toEqual(["2026-11"]);
  });
  it("honours skipped months and the end date", () => {
    expect(duePeriods(plan({ skippedPeriods: ["2026-10"] }), "2026-11-16", new Set())).toEqual(["2026-11"]);
    expect(duePeriods(plan({ endDate: "2026-10-31" }), "2026-12-16", new Set())).toEqual(["2026-10"]);
  });
  it("handles billing day 28 in February and year end", () => {
    expect(duePeriods(plan({ startDate: "2026-12-01", billingDay: 28 }), "2027-02-28", new Set())).toEqual(["2026-12", "2027-01", "2027-02"]);
  });
  it("does nothing for paused plans", () => {
    expect(duePeriods(plan({ status: "paused" }), "2026-11-16", new Set())).toEqual([]);
  });
  it("rejects billing days above 28", () => {
    expect(() => duePeriods(plan({ billingDay: 31 }), "2026-11-16", new Set())).toThrow();
  });
  it("shows the next invoice date", () => {
    expect(nextBillingDate(plan({ startDate: "2026-11-01", billingDay: 20 }), "2026-11-16", new Set())).toBe("2026-11-20");
    expect(nextBillingDate(plan({ startDate: "2026-11-01", billingDay: 5 }), "2026-11-16", new Set(["2026-11"]))).toBe("2026-12-05");
    expect(nextBillingDate(plan({ startDate: "2026-11-01", billingDay: 5 }), "2026-11-16", new Set())).toBe("2026-11-16"); // due now, created on the next run
    expect(nextBillingDate(plan({ startDate: "2026-11-01", billingDay: 5, endDate: "2026-11-30" }), "2026-11-16", new Set(["2026-11"]))).toBeNull();
  });
});

describe("reminders", () => {
  const offsets = [-3, 0, 3, 7, 14];
  const due = "2026-11-30";
  it("sends 3 days before, on the day and when overdue", () => {
    expect(pickReminderStep(offsets, due, "2026-11-26", [])).toBeNull();
    expect(pickReminderStep(offsets, due, "2026-11-27", [])).toBe(-3);
    expect(pickReminderStep(offsets, due, "2026-11-30", [-3])).toBe(0);
    expect(pickReminderStep(offsets, due, "2026-12-03", [-3, 0])).toBe(3);
    expect(pickReminderStep(offsets, due, "2026-12-07", [-3, 0, 3])).toBe(7);
    expect(pickReminderStep(offsets, due, "2026-12-14", [-3, 0, 3, 7])).toBe(14);
  });
  it("sends each step once", () => {
    expect(pickReminderStep(offsets, due, "2026-11-28", [-3])).toBeNull();
    expect(pickReminderStep(offsets, due, "2026-12-20", [-3, 0, 3, 7, 14])).toBeNull();
  });
  it("after missed days sends only the latest step reached", () => {
    expect(pickReminderStep(offsets, due, "2026-12-08", [])).toBe(7);
  });
  it("flags follow-up after the last step", () => {
    expect(needsFollowUp(offsets, due, "2026-12-14")).toBe(false);
    expect(needsFollowUp(offsets, due, "2026-12-15")).toBe(true);
  });
  it("chooses the right template and parses offsets", () => {
    expect(reminderTemplate(-3)).toBe("reminder_before");
    expect(reminderTemplate(0)).toBe("reminder_due");
    expect(reminderTemplate(7)).toBe("reminder_overdue");
    expect(parseOffsets("14, -3 0,7 3")).toEqual([-3, 0, 3, 7, 14]);
    expect(() => parseOffsets("abc")).toThrow();
  });
});
