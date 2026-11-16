/** Reads configuration from process.env (Wrangler vars/secrets in production, .env locally). */
export function env(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v !== undefined && v !== "") return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing environment variable ${name}`);
}

export function optionalEnv(name: string): string | undefined {
  const v = process.env[name];
  return v === undefined || v === "" ? undefined : v;
}

/** MONGODB_URI may contain the literal "<password>"; it is replaced with MONGODB_PASSWORD. */
export function mongoUri(): string {
  const uri = env("MONGODB_URI");
  if (!uri.includes("<password>")) return uri;
  const pw = optionalEnv("MONGODB_PASSWORD");
  if (!pw) throw new Error("MONGODB_PASSWORD is not set (MONGODB_URI contains <password>)");
  return uri.replace("<password>", encodeURIComponent(pw));
}

export function appUrl(path = ""): string {
  const base = env("APP_URL", "http://localhost:3000").replace(/\/$/, "");
  return base + path;
}

export function superAdminEmail(): string {
  return env("SUPER_ADMIN_EMAIL", "dev@tenxcreative.com").toLowerCase();
}

export function isWorkersRuntime(): boolean {
  return typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";
}
