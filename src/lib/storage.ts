import { ObjectId } from "mongodb";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { cols } from "./db";
import { randomToken } from "./auth/crypto";
import type { FileDoc } from "./types";

/*
 * One private R2 bucket (binding FILES). Objects get random keys; the original file name is
 * kept as metadata. There are no public URLs: downloads go through /api/files/[id], which
 * checks permission first.
 */

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const ALLOWED_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;

interface R2Like {
  put(key: string, value: ArrayBuffer | Uint8Array, opts?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> }): Promise<unknown>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer>; body: ReadableStream } | null>;
  delete(key: string): Promise<void>;
}

async function bucket(): Promise<R2Like> {
  const { env } = await getCloudflareContext({ async: true });
  const b = (env as unknown as { FILES?: R2Like }).FILES;
  if (!b) throw new Error("R2 binding FILES is not configured");
  return b;
}

/** Detects the real type from the file signature (magic bytes). */
export function sniffType(bytes: Uint8Array): (typeof ALLOWED_TYPES)[number] | null {
  if (bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d) return "application/pdf";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
  return null;
}

export class UploadError extends Error {}

export async function validateUpload(file: File | null | undefined, opts: { pdfOnly?: boolean } = {}): Promise<Uint8Array> {
  if (!file || typeof file === "string" || file.size === 0) throw new UploadError("Please choose a file.");
  if (file.size > MAX_UPLOAD_BYTES) throw new UploadError("The file is larger than 10 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffType(bytes);
  if (!type) throw new UploadError("Only PDF, JPG and PNG files can be uploaded.");
  if (opts.pdfOnly && type !== "application/pdf") throw new UploadError("Please upload a PDF file.");
  return bytes;
}

function safeName(name: string): string {
  return name.replace(/[^\w.\- ()]/g, "_").slice(0, 150) || "file";
}

export async function storeFile(input: {
  bytes: Uint8Array;
  originalName: string;
  kind: FileDoc["kind"];
  companyId?: ObjectId;
  relatedId?: ObjectId;
  uploadedBy?: ObjectId;
}): Promise<FileDoc> {
  const contentType = sniffType(input.bytes);
  if (!contentType) throw new UploadError("Only PDF, JPG and PNG files can be uploaded.");
  const key = `${input.kind}/${new Date().getUTCFullYear()}/${randomToken(18)}`;
  const b = await bucket();
  await b.put(key, input.bytes, {
    httpMetadata: { contentType },
    customMetadata: { originalName: safeName(input.originalName) },
  });
  const doc: FileDoc = {
    _id: new ObjectId(),
    key,
    originalName: safeName(input.originalName),
    contentType,
    size: input.bytes.byteLength,
    companyId: input.companyId,
    kind: input.kind,
    relatedId: input.relatedId,
    uploadedBy: input.uploadedBy,
    createdAt: new Date(),
  };
  const c = await cols();
  await c.files.insertOne(doc);
  return doc;
}

export async function readFile(file: FileDoc): Promise<Uint8Array> {
  const b = await bucket();
  const obj = await b.get(file.key);
  if (!obj) throw new Error(`File ${file._id} is missing from storage`);
  return new Uint8Array(await obj.arrayBuffer());
}

export async function getFileDoc(id: ObjectId | string): Promise<FileDoc | null> {
  const c = await cols();
  try {
    return await c.files.findOne({ _id: new ObjectId(id) });
  } catch {
    return null;
  }
}
