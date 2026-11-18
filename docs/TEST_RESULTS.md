# Test Run — 18 Nov 2026

**Target:** production `https://portal.tenxcreative.com` (no-login checks only) + a local production build (`next build && next start`) against an in-memory MongoDB with `EMAIL_PROVIDER=console`. No production data was created or changed.
**Case list:** `docs/TEST_CASES.md` (every case has its status from this run).

| Result | Count |
|---|---|
| PASS | 67 |
| FIXED (failed, fixed, re-tested) | 6 |
| HOLD (needs R2) | 12 |
| NOT RUN | 51 |

`npm test` (48 tests), `npm run typecheck` and `next build` all pass after the fixes.

---

## Failures found and fixed (not committed)

### 1. Admin dashboard, Plans list and plan page crash — P0 (PLN-08, ADM-01)
* **Symptom:** "Something went wrong — We could not load this page" on `/admin`, `/admin/plans` and `/admin/plans/[id]` as soon as any active plan has its invoice for the current month.
* **Cause:** a Turbopack production-build bug. In `nextBillingDate()` (`src/lib/schedule.ts`) the loop `for (let i = 0; i < 36; i++, p = nextPeriod(p))` was compiled with `nextPeriod` left unbound → `ReferenceError: nextPeriod is not defined`. The source is correct; unit tests and `tsc` pass because they never run the bundle.
* **Fix:** moved `p = nextPeriod(p)` out of the for-update clause into the loop body (same logic). Rebuilt, scanned the whole `.next/server` output for other unbound imported calls: none.
* **Affects production:** yes. It will start crashing the admin dashboard on the first billing day after a plan is created. Deploy this fix before creating real recurring plans.

### 2. "Send invoice" locks the invoice as Sent even when the email fails — P0 (INV-16)
* **Symptom:** admin clicks Send → "Something went wrong", but the invoice is now **Sent** (locked, no email, no email-log row).
* **Cause:** `sendInvoice()` (`src/lib/services/invoices.ts`) flipped the status to Sent *before* building the PDF and checking recipients.
* **Fix:** recipients and PDF are prepared first; the status changes only after they succeed. Re-tested: on failure the invoice stays Draft. Same ordering fix applied to `sendProposal()` with "Attach PDF" (`src/lib/services/proposals.ts`, PRO-14).
* **Affects production:** yes. With R2 unbound, every emailed invoice send fails this way today.

### 3. CSP blocks Cloudflare Web Analytics beacon — P1 (PLT-11)
* **Symptom:** console error on every production page: `static.cloudflareinsights.com/beacon.min.js` violates `script-src`.
* **Fix:** `next.config.ts` CSP now allows `https://static.cloudflareinsights.com` (script-src) and `https://cloudflareinsights.com` (connect-src). Alternative: turn off Web Analytics for the zone in Cloudflare.

## On hold — R2 storage (as requested)

Production `/api/health` returns `r2: "R2 binding FILES is not configured"` (the `r2_buckets` line is commented out in `wrangler.jsonc`). Everything that stores a file fails until R2 is bound:

* Emailing an invoice (PDF attachment) — INV-05
* Downloading an invoice/proposal PDF — INV-12, PRO-05
* Uploading an invoice/proposal PDF — INV-11, PRO-13
* Client payment slips and admin confirm/reject — PAY-05/06/07
* Payment receipt files and receipt PDF emails — PAY-04 (the payment itself is still recorded; the receipt PDF step logs an error)
* Signed proposal copy, settings logo — PRO-09, ADM-03

Statement PDF/CSV and report CSVs do not use R2 and work.

## Things to check that tests could not reach

* **EML-05 `APP_URL` in production.** It was removed from `wrangler.jsonc` vars (commit `08d4be6`) and `keep_vars` is on, so the value lives only in the Cloudflare dashboard. If it is still the old `example.workers.dev` URL, every activation / reset / invoice link in emails is wrong. Check Workers → Settings → Variables: it must be `https://portal.tenxcreative.com`.
* **HLT-04** test email from production: `curl -H "Authorization: Bearer $CRON_SECRET" "https://portal.tenxcreative.com/api/health?email=you@tenxcreative.com"`.

## Minor observations (not fixed)

* `/favicon.ico` returns 404 (pages declare `/favicon.svg`, so browsers are fine).
* Admins → "Last sign-in" stays "Never" for a user who only signed in through an activation or reset link.
* "View as client" greets the admin by their own first name ("Welcome, Second") instead of the client contact.
* A proposal with LKR 0.00 total (template with no prices filled in) can be sent and accepted. Consider blocking send when total is 0.
* A not-found invoice/proposal page for another company returns HTTP 200 with the not-found content (no data leaks; streaming behaviour of Next.js).

## Files changed

| File | Change |
|---|---|
| `src/lib/schedule.ts` | Work around Turbopack mis-compile in `nextBillingDate()` |
| `src/lib/services/invoices.ts` | Prepare PDF + recipients before marking Sent |
| `src/lib/services/proposals.ts` | Build PDF before marking Sent |
| `next.config.ts` | CSP allows Cloudflare Web Analytics |
| `docs/TEST_CASES.md` | New: main test case list with statuses |
| `docs/TEST_RESULTS.md` | New: this report |

## How to re-run the local E2E setup

1. Start an in-memory replica set (port 27099) with `mongodb-memory-server`.
2. Create `.env.production.local` (git-ignored) with `MONGODB_URI=mongodb://127.0.0.1:27099/?replicaSet=testset`, `MONGODB_PASSWORD=` (empty), `MONGODB_DB=tenx_e2e`, `APP_URL=http://localhost:3000`, `EMAIL_PROVIDER=console`.
3. Seed: run `npx tsx scripts/seed.ts` with the same variables set in the shell; it prints the super admin activation link.
4. `npx next build && npx next start -p 3000`. Activation/reset links appear in the server output.
5. Daily job: `curl -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/daily`.
6. Delete `.env.production.local` afterwards so a later `next build` does not pick it up.
