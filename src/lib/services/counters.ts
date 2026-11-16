import type { ClientSession } from "mongodb";
import { cols } from "../db";

export function formatNumber(prefix: string, year: number, seq: number, width: number): string {
  return `${prefix}-${year}-${String(seq).padStart(width, "0")}`;
}

/** Atomic counter per type and year. Numbers are never reused, even if the document is voided. */
export async function nextSequence(type: "invoice" | "proposal", year: number, session?: ClientSession): Promise<number> {
  const c = await cols();
  const res = await c.counters.findOneAndUpdate(
    { _id: `${type}-${year}` },
    { $inc: { seq: 1 }, $setOnInsert: { type, year } },
    { upsert: true, returnDocument: "after", session },
  );
  return res!.seq;
}

export async function nextInvoiceNumber(prefix: string, year: number, session?: ClientSession) {
  return formatNumber(prefix, year, await nextSequence("invoice", year, session), 4);
}

export async function nextProposalReference(prefix: string, year: number, session?: ClientSession) {
  return formatNumber(prefix, year, await nextSequence("proposal", year, session), 3);
}
