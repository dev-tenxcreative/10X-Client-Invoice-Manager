/** Triggers the daily job on a running app (local or deployed): npm run cron:local [-- https://your-app] */
import "./load-env";

const base = process.argv[2] ?? process.env.APP_URL ?? "http://localhost:3000";
const res = await fetch(new URL("/api/cron/daily", base), { method: "POST", headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
console.log(res.status, JSON.stringify(await res.json().catch(() => ({})), null, 2));
