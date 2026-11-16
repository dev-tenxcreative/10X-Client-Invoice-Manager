import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";

/*
 * Password hashing uses scrypt from node:crypto, which runs natively on Workers (nodejs_compat).
 * N=16384, r=8, p=1 uses 16 MB and is within Workers CPU limits on the Paid plan.
 * Parameters are stored with each hash so they can be raised later.
 */
const N = 16384, R = 8, P = 1, KEYLEN = 32;

function scrypt(password: string, salt: Buffer, n: number, r: number, p: number, keylen: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password.normalize("NFKC"), salt, keylen, { N: n, r, p, maxmem: 64 * 1024 * 1024 }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, N, R, P, KEYLEN);
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string | undefined): Promise<boolean> {
  if (!stored) {
    // Spend similar time so missing accounts are not detectable by timing.
    await scrypt(password, randomBytes(16), N, R, P, KEYLEN);
    return false;
  }
  const [alg, n, r, p, saltB64, keyB64] = stored.split("$");
  if (alg !== "scrypt") return false;
  const expected = Buffer.from(keyB64, "base64");
  const key = await scrypt(password, Buffer.from(saltB64, "base64"), Number(n), Number(r), Number(p), expected.length);
  return key.length === expected.length && timingSafeEqual(key, expected);
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
