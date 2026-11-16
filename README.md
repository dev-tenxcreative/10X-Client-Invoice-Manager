# 10X Creative Client Portal

A portal for 10X Creative (Pvt) Ltd. Admins manage clients, companies, proposals, invoices, payments, monthly recurring billing and reminder emails. Clients sign in to see and pay their invoices, accept proposals and download statements.

**Stack:** Next.js 16 (App Router, TypeScript strict), Tailwind CSS 4, Zod, MongoDB Atlas (official driver 7), Cloudflare Workers through `@opennextjs/cloudflare`, R2 for files, a Cron Trigger for the daily job, Browser Run for PDFs and Gmail SMTP through Nodemailer.

---

## 1. Setup

```bash
npm install
cp .env.example .env        # then fill in the values (see below)
npm run seed                # indexes, settings, super admin, demo data
npm run dev                 # http://localhost:3000
```

`npm run seed` prints the super admin's activation link and also emails it. Open it, set a password and you are signed in.

Demo data (two companies, one proposal, three invoices) is marked `isDemo`. Remove it with:

```bash
npm run seed:remove-demo
```

Use `npm run seed -- --no-demo` to skip demo data.

> **npm 11 note:** install scripts are blocked by default. If `wrangler` or `tsx` complain about missing binaries, run `npm install-scripts approve esbuild workerd` and then `npm rebuild esbuild workerd`.

## 2. Environment variables

| Variable | Purpose |
|---|---|
| `MONGODB_URI` | Atlas connection string. Keep the literal `<password>`; the app replaces it with `MONGODB_PASSWORD` (URL-encoded). |
| `MONGODB_PASSWORD` | Password of the Atlas database user `dev_db_user`. |
| `MONGODB_DB` | Database name (default `tenx_portal`). |
| `APP_URL` | Public URL used in email links, for example `https://portal.tenxcreative.com`. |
| `SESSION_SECRET` | Random secret (32+ bytes). Already generated in `.env`. |
| `CRON_SECRET` | Protects `/api/cron/daily` and `/api/health`. Already generated in `.env`. |
| `SUPER_ADMIN_EMAIL` | `dev@tenxcreative.com`. This account cannot be deleted, deactivated, demoted or renamed. |
| `EMAIL_PROVIDER` | `smtp` (Gmail) or `console` (development: logs emails instead of sending). |
| `SMTP_HOST` / `SMTP_PORT` | `smtp.gmail.com` / `465`. |
| `SMTP_USER` | The Gmail or Google Workspace mailbox that sends. |
| `SMTP_PASS` | That mailbox's **App Password** (16 characters). |
| `EMAIL_FROM` | For example `10X Creative <billing@tenxcreative.com>`. Must be the mailbox or a verified "Send mail as" alias. |
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile. It is shown after the second failed sign-in. If these are empty, Turnstile is off. |

The R2 bucket (`FILES`) and Browser Run (`BROWSER`) are bindings in `wrangler.jsonc`, not environment variables.

### Gmail App Password

1. Sign in to the sending mailbox. Turn on **2-Step Verification** (Google Account → Security).
2. Open **Google Account → Security → App passwords** and create one called "10X Portal".
3. Put the 16 characters in `SMTP_PASS`. Spaces are ignored.
4. To send as `billing@tenxcreative.com` from another mailbox, add it under Gmail → Settings → Accounts → *Send mail as*.
5. Gmail limits how many emails a day each account can send. Set **Settings → Tax, currency & numbering → Daily email limit** below that limit. Emails over the limit are queued for the next day.

### Atlas network access

Cloudflare Workers do not have fixed outgoing IP addresses. In Atlas → Network Access, allow `0.0.0.0/0` and rely on a strong password plus a least-privilege user. `dev_db_user` only needs **readWrite on `tenx_portal`**. If your Atlas tier supports Private Endpoints or the Atlas Data API with IP allow-listing through a proxy, you can use that instead.

## 3. Local development

* `npm run dev` runs Next.js with local copies of the Cloudflare bindings (`initOpenNextCloudflareForDev`). R2 is stored under `.wrangler/state`.
* Browser Run is not available locally, so PDFs use the **pdf-lib fallback**: simpler layout, same data, A4, "Page x of y". On the deployed Worker the PDF is rendered by Browser Run from the same HTML template as the on-screen preview.
* Set `EMAIL_PROVIDER=console` to see emails in the terminal and the Email log without sending.
* Run the daily job by hand: `npm run cron:local` (or `npm run cron:local -- https://your-worker-url`).
* `npm run preview` builds the Worker and runs it locally in `workerd`. Wrangler reads secrets from `.dev.vars`, so copy the needed lines from `.env` into it.

## 4. Tests

```bash
npm test          # money, numbering, dates/time zone, recurring rules, reminders, permissions,
                  # plus MongoDB integration tests (in-memory replica set):
                  # client A cannot read client B's invoice, atomic client creation,
                  # super admin protection, one invoice per plan per month, reminders once
npm run typecheck
```

Playwright end-to-end tests are **not written yet**. See "Known gaps" below.

## 5. Daily job (cron)

There is one Cron Trigger, `30 2 * * *`: 02:30 UTC, which is 08:00 in Colombo. `custom-worker.ts` wraps the OpenNext worker and adds a `scheduled()` handler. That handler calls `POST /api/cron/daily` with `CRON_SECRET`. Each run does the following:

1. **Recurring plans**: for every active plan, creates any month whose billing day has arrived (and catches up missed days). A unique index on `{planId, period}` guarantees one invoice per month. Auto-mode plans email the client. Review-mode plans email admins that a draft is waiting.
2. **Proposals**: marks proposals past their valid-until date as Expired.
3. **Reminders**: sends 3 days before, on the due date, and 3, 7 and 14 days overdue (editable). Each step is sent once (unique `{invoiceId, step}`) and never for Draft, Paid or Void invoices. After the last step, the invoice is flagged and admins are emailed.
4. **Monday digest** of overdue invoices to admins (once per Monday).
5. **Email retries**: failed sends are retried up to 3 times, and queued sends go out after the daily limit resets.

Every step can safely run twice.

## 6. Deployment (Cloudflare Workers)

```bash
npx wrangler login
npx wrangler r2 bucket create tenx-portal-files
# Set secrets (repeat for each):
npx wrangler secret put MONGODB_URI
npx wrangler secret put MONGODB_PASSWORD
npx wrangler secret put SESSION_SECRET
npx wrangler secret put CRON_SECRET
npx wrangler secret put SMTP_USER
npx wrangler secret put SMTP_PASS
npx wrangler secret put EMAIL_FROM
npx wrangler secret put TURNSTILE_SITE_KEY
npx wrangler secret put TURNSTILE_SECRET_KEY
# Set APP_URL in wrangler.jsonc "vars" to the real URL, then:
npm run deploy
```

Then check the platform. The health check verifies MongoDB, password hashing time, PDF rendering (it reports `engine: browser-run` when Browser Run works) and R2. Adding `?email=` also sends one test email.

```bash
curl -H "Authorization: Bearer $CRON_SECRET" "https://<worker-url>/api/health?email=you@tenxcreative.com"
```

Finally, run `npm run seed` once against production, with `.env` pointing at the production Atlas database.

**Plan:** use the Workers Paid plan. Password hashing (scrypt) and PDF rendering exceed the free plan's CPU limits.

### Production checklist

- [ ] `APP_URL` is the real HTTPS URL.
- [ ] Atlas user is least-privilege and Network Access is configured.
- [ ] Bank details are filled in under Settings → Bank details. They are empty on purpose; the portal never makes up bank details.
- [ ] Registration and tax numbers are filled in, if they should print on invoices.
- [ ] Default terms in proposals have been reviewed by a lawyer. They are marked as a draft.
- [ ] SPF, DKIM and DMARC are set up (below).
- [ ] `/api/health` shows `browser-run`, R2 and MongoDB OK, and the test email arrives.
- [ ] The cron run is visible in Workers → Logs the next morning (or trigger it with `npm run cron:local -- <url>`).

## 7. Email deliverability (tenxcreative.com)

* **SPF**: one TXT record on `tenxcreative.com` that includes Google, for example `v=spf1 include:_spf.google.com ~all`. Merge it with any existing SPF record; never publish two.
* **DKIM**: Google Workspace Admin → Apps → Gmail → Authenticate email → generate a 2048-bit key. Add the TXT record (`google._domainkey`), then click *Start authentication*.
* **DMARC**: start with `_dmarc.tenxcreative.com TXT "v=DMARC1; p=none; rua=mailto:dmarc@tenxcreative.com"`. Move to `p=quarantine` once reports look clean.
* Send from the same domain as the authenticated mailbox (`billing@tenxcreative.com`).

## 8. Backup and restore

**Atlas.** Turn on Cloud Backup (M10+) or scheduled snapshots. For a manual export:

```bash
mongodump --uri "mongodb+srv://dev_db_user:PASSWORD@clientmanager.de7bfbd.mongodb.net/tenx_portal" --out backup-$(date +%F)
mongorestore --uri "..." --nsInclude "tenx_portal.*" backup-YYYY-MM-DD/
```

**R2.** Objects are referenced from the `files` collection by key. Copy the bucket with `rclone` (S3-compatible R2 endpoint) on a schedule, for example `rclone sync r2:tenx-portal-files backup:tenx-portal-files`. Restore the database and the bucket from the same point in time.

## 9. How it is organised

```
src/
  app/                     routes (admin/*, portal/*, auth pages, api/*)
  app/actions/             server actions (auth, admin, portal); all validate with Zod on the server
  components/              UI (server components) and components/client (interactive)
  lib/
    services/              business logic: users, companies, invoices, payments, plans,
                           reminders, proposals, reports, jobs, audit, counters, settings
    documents/             invoice and proposal HTML templates (screen preview + PDF)
    pdf/                   Browser Run renderer and pdf-lib fallback
    email/                 sendEmail(), provider switch, templates and the branded layout
    auth/                  sessions, scrypt hashing, password policy, rate limits, Turnstile
    money.ts dates.ts schedule.ts   pure rules (unit-tested)
    i18n.ts                interface text in one place (for Sinhala and Tamil later)
scripts/                   seed, remove-demo, run-cron
custom-worker.ts           adds the Cron Trigger handler to the OpenNext worker
```

### Rules worth knowing

* **Money** is stored as integers in minor units (cents), with a currency code on every document. All totals are calculated on the server, and amounts in different currencies are never added together.
* **Dates** are stored as `YYYY-MM-DD` in Asia/Colombo time and displayed like "16 Nov 2026".
* **Numbers** come from atomic counters: invoices `10X-INV-YYYY-NNNN`, proposals `10X-PRO-YYYY-NNN`. Numbers are never reused, and a discarded draft is voided rather than deleted.
* **Access control**: every server action and API route checks the session and role. Client data is always filtered by the company IDs from the user's memberships on the server. Another company's record looks exactly like a missing one.
* **Files** live in a private R2 bucket under random keys. They are downloaded only through `/api/files/[id]`, after a permission check. Only PDF, JPG and PNG are allowed, checked by file signature, up to 10 MB.
* **Sessions** use an httpOnly, Secure, SameSite=Lax cookie holding an opaque token; only its hash is stored. Clients get 7 days (rolling), admins 12 hours.
* **Audit log** is append-only. Financial records are voided or archived, never deleted.

## 10. Choices and known gaps

* **Adapter:** `@opennextjs/cloudflare` (stable), chosen over the beta `vinext` because this is a billing system.
* **React Hook Form and shadcn/ui** were not used. Forms are small client components that call server actions, validate with Zod on the server, keep typed data on errors and show inline messages. The UI kit is a small set of Tailwind components in `src/components/ui.tsx`. Either library can be added later without changing the services.
* **Password hashing:** scrypt (N=16384, r=8, p=1) from `node:crypto`. `/api/health` reports the time it takes on the deployed Worker.
* **MongoDB on Workers:** one client per request (React `cache` for pages and actions, AsyncLocalStorage for routes and cron). If page latency on the deployed Worker is too high, move database access into a Durable Object as Cloudflare's MongoDB guide describes.
* **Email on Workers:** Nodemailer's SMTP transport is used. If it fails on the deployed Worker (check `/api/health?email=`), switch the provider to a Workers-native SMTP client such as `worker-mailer`. Only `deliverSmtp()` in `src/lib/email/index.ts` changes.
* **Not done yet:** Playwright end-to-end tests, a table of contents based on real page count (it is estimated today), and pruning of orphaned R2 objects after demo removal.
