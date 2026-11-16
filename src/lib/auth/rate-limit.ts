import { cols } from "../db";
import { optionalEnv } from "../env";

/** Sliding-window counter stored in MongoDB (rateLimits has a 1-hour TTL index). */
export async function recentHits(key: string, windowMs: number): Promise<number> {
  const c = await cols();
  return c.rateLimits.countDocuments({ key, at: { $gte: new Date(Date.now() - windowMs) } });
}

export async function hit(key: string): Promise<void> {
  const c = await cols();
  await c.rateLimits.insertOne({ key, at: new Date() });
}

export async function clearHits(key: string): Promise<void> {
  const c = await cols();
  await c.rateLimits.deleteMany({ key });
}

/** Records a hit and reports whether the caller is over `max` in `windowMs`. */
export async function limited(key: string, max: number, windowMs: number): Promise<boolean> {
  const n = await recentHits(key, windowMs);
  if (n >= max) return true;
  await hit(key);
  return false;
}

export function turnstileEnabled(): boolean {
  return Boolean(optionalEnv("TURNSTILE_SITE_KEY") && optionalEnv("TURNSTILE_SECRET_KEY"));
}

export async function verifyTurnstile(token: string | null | undefined, ip?: string): Promise<boolean> {
  const secret = optionalEnv("TURNSTILE_SECRET_KEY");
  if (!secret) return true;
  if (!token) return false;
  const body = new FormData();
  body.append("secret", secret);
  body.append("response", token);
  if (ip) body.append("remoteip", ip);
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch (e) {
    console.error("[turnstile] verify failed", e);
    return false;
  }
}
