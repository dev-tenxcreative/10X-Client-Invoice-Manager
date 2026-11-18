# 10X Client Portal — Main Test Cases

Production URL: **https://portal.tenxcreative.com**
Use this list for every release: run the **Smoke** set on production after each deploy, and the full list against a local or staging copy before a major change.

**How to read this**

| Column | Meaning |
|---|---|
| ID | Stable ID. Never reuse an ID; add new cases at the end of a section. |
| Pri | P0 = release blocker, P1 = must work, P2 = nice to have |
| Where | `Prod` = safe to run on production (no data created), `Local` = run against a local/staging copy with test data, `Both` |
| Status | Result of the last run (see "Last run" at the bottom). `PASS`, `FIXED` (failed, fixed, re-tested), `HOLD` (waiting on R2 storage), `NOT RUN`. |

Test accounts (local run): super admin `dev@tenxcreative.com` (activated from the seed link), a second admin and a client contact created during the run. Never use real client emails for testing.

---

## 1. Platform, routing and security headers

| ID | Pri | Where | Test case | Expected result | Status |
|---|---|---|---|---|---|
| PLT-01 | P0 | Prod | Open `https://portal.tenxcreative.com/` signed out | 307 redirect to `/sign-in` | PASS |
| PLT-02 | P0 | Prod | Open `http://portal.tenxcreative.com/` | Redirects to HTTPS | PASS |
| PLT-03 | P0 | Prod | `/sign-in`, `/forgot-password`, `/first-time`, `/no-access` load | 200, page renders, no console errors | PASS |
| PLT-04 | P0 | Prod | `/admin` and `/portal` signed out | Redirect to `/sign-in` | PASS |
| PLT-05 | P1 | Prod | Unknown URL (`/does-not-exist`) | 404 page in brand style | PASS |
| PLT-06 | P0 | Prod | Response headers on any page | CSP, HSTS, `X-Frame-Options: DENY`, `nosniff`, Referrer-Policy, Permissions-Policy present; no `X-Powered-By` | PASS |
| PLT-07 | P1 | Prod | Favicon and fonts load | No 404s in network tab | FIXED |
| PLT-08 | P1 | Both | Pages at phone width (375px) | No horizontal scroll, menu usable | NOT RUN |
| PLT-09 | P0 | Local | `npm test` and `npm run typecheck` | All pass | PASS |
| PLT-10 | P0 | Local | `npm run build` (`next build`) | Builds with no errors | PASS |
| PLT-11 | P1 | Prod | Browser console on `/sign-in` and a signed-in page | No CSP errors (Cloudflare Web Analytics beacon allowed) | FIXED |
| PLT-12 | P0 | Local | After `next build`, scan `.next/server` for unbound imported calls (see TEST_RESULTS.md) | None found | PASS |

## 2. Health check and cron endpoints

| ID | Pri | Where | Test case | Expected result | Status |
|---|---|---|---|---|---|
| HLT-01 | P0 | Prod | `GET /api/health` without auth | `{"ok":true}` only, no details leaked | PASS |
| HLT-02 | P0 | Prod | `GET /api/health` with `Authorization: Bearer CRON_SECRET` | `mongodb.ok`, `passwordHash.ok`, `pdf.ok` with `engine: browser-run` | PASS |
| HLT-03 | P1 | Prod | Health `r2` check | `r2.ok: true` | HOLD (fails: R2 not bound) |
| HLT-04 | P1 | Prod | Health with `?email=you@…` | Test email arrives | NOT RUN |
| HLT-05 | P0 | Prod | `GET /api/cron/daily` | 405 (POST only) | PASS |
| HLT-06 | P0 | Prod | `POST /api/cron/daily` without / with wrong secret | 401, job does not run | PASS |
| HLT-07 | P1 | Local | `POST /api/cron/daily` with secret | Runs plans, expiry, reminders, digest, retries; returns summary | PASS |
| HLT-08 | P1 | Local | Run the daily job twice the same day | Second run creates nothing new (idempotent) | PASS |

## 3. Authentication

| ID | Pri | Where | Test case | Expected result | Status |
|---|---|---|---|---|---|
| AUTH-01 | P0 | Both | Sign in with empty email or password | "Please enter your email and password." | NOT RUN |
| AUTH-02 | P0 | Both | Sign in with wrong password / unknown email | Same generic error for both (no account enumeration) | PASS |
| AUTH-03 | P0 | Local | Sign in as admin with correct password | Lands on `/admin` | PASS |
| AUTH-04 | P0 | Local | Sign in as client with correct password | Lands on `/portal` | PASS |
| AUTH-05 | P0 | Local | 5 wrong passwords in 15 min for one email+IP | Account locked message; correct password also refused until window passes | PASS |
| AUTH-06 | P1 | Local | Turnstile keys set, 2 failures | Turnstile widget shown and required | NOT RUN (no Turnstile keys) |
| AUTH-07 | P0 | Both | Session cookie flags | `tenx_session` is HttpOnly, Secure (prod), SameSite=Lax | PASS (code review) |
| AUTH-08 | P0 | Local | Sign out | Session removed; back button / `/admin` redirects to sign-in | PASS |
| AUTH-09 | P1 | Local | "Sign out everywhere" | All sessions of the user end | NOT RUN |
| AUTH-10 | P0 | Local | Activation link: set password (valid) | Account active, signed in, redirected by role | PASS |
| AUTH-11 | P0 | Local | Activation link used twice / expired / garbage token | "Link is no longer valid" message, no password set | PASS |
| AUTH-12 | P0 | Local | Password policy: < 10 chars, common password, contains email name, mismatch | Each refused with a clear field message | PASS |
| AUTH-13 | P1 | Both | "First time here?" with any email | Always the same success message (no enumeration) | NOT RUN |
| AUTH-14 | P1 | Local | "First time here?" for invited user | New activation email; old link stops working | NOT RUN |
| AUTH-15 | P0 | Both | Forgot password with any email | Always the same success message | PASS |
| AUTH-16 | P0 | Local | Reset link: set new password | Password changed, other sessions signed out, "password changed" email | PASS |
| AUTH-17 | P1 | Local | Reset link reused / older link after a newer one | Refused | PASS |
| AUTH-18 | P1 | Local | Rate limits on forgot / first-time (10 per IP, 3 per email per 15 min) | Extra requests silently ignored | NOT RUN |
| AUTH-19 | P0 | Local | Deactivated user tries to sign in / uses existing session | Refused; session invalid | NOT RUN |
| AUTH-20 | P1 | Local | Change password (wrong current, mismatch, success) | Correct messages; other devices signed out | NOT RUN |
| AUTH-21 | P1 | Local | Update profile (name < 2 chars, success) | Validation / saved | NOT RUN |
| AUTH-22 | P2 | Local | Admin session expires after 12 h; client session rolls for 7 days | Matches policy | NOT RUN |

## 4. Roles and access control

| ID | Pri | Where | Test case | Expected result | Status |
|---|---|---|---|---|---|
| ACL-01 | P0 | Local | Client opens any `/admin/*` URL | Redirect to `/portal` | PASS |
| ACL-02 | P0 | Local | Admin opens `/portal` (without "View as") | Redirect to `/admin` | PASS |
| ACL-03 | P0 | Local | Normal admin opens `/admin/admins` and tries admin actions | List is read-only, no invite/deactivate/remove controls; server actions refused (super admin only) | PASS |
| ACL-04 | P0 | Local | Client A opens client B's invoice or proposal URL | 404 (looks missing) | PASS |
| ACL-05 | P0 | Both | `/api/invoices/{id}/pdf`, `/api/proposals/{id}/pdf`, `/api/files/{id}`, `/api/statement/*`, `/api/reports/*` signed out | 401 | PASS |
| ACL-06 | P0 | Local | Client calls another company's PDF / file API | 404 | PASS |
| ACL-07 | P0 | Local | Client opens a Draft invoice URL of their own company | 404 (drafts hidden) | NOT RUN |
| ACL-08 | P0 | Local | Client calls `/api/reports/*` | 401/404, no data | PASS |
| ACL-09 | P0 | Local | Super admin cannot be deactivated, removed, demoted or have email changed | Error shown, nothing changes | PASS |
| ACL-10 | P1 | Local | Client with no company membership signs in | `/no-access` page | NOT RUN |
| ACL-11 | P1 | Local | Client with 2 companies switches company | Only that company's data shown | NOT RUN |
| ACL-12 | P1 | Local | Admin "View as client" | Portal shows that company read-only; submit actions refused | PASS |

## 5. Admin — clients and companies

| ID | Pri | Where | Test case | Expected result | Status |
|---|---|---|---|---|---|
| CMP-01 | P0 | Local | Create client: new company + contact, invite on | Company + user + membership created; invitation email logged | PASS |
| CMP-02 | P0 | Local | Create client: required fields empty / bad email / terms > 120 | Inline field errors; typed data kept | PASS |
| CMP-03 | P1 | Local | Duplicate company name or contact email | Duplicate warning / refused | PASS |
| CMP-04 | P1 | Local | Add contact to existing company | Contact listed; optional invite | NOT RUN |
| CMP-05 | P1 | Local | Unlink contact | Contact removed from company only | NOT RUN |
| CMP-06 | P1 | Local | Edit company (address, currency, terms, billing emails) | Saved, audit log entry | NOT RUN |
| CMP-07 | P1 | Local | Archive / unarchive company | Hidden from active list; data kept | NOT RUN |
| CMP-08 | P1 | Local | Company list search and status filter | Correct results | NOT RUN |
| CMP-09 | P2 | Local | Resend / cancel client invitation | Works; cancelled link stops working | NOT RUN |

## 6. Admin — invoices

| ID | Pri | Where | Test case | Expected result | Status |
|---|---|---|---|---|---|
| INV-01 | P0 | Local | Create generated invoice (items, discount, tax) | Draft saved; totals calculated on server in minor units | PASS |
| INV-02 | P0 | Local | Invoice number format | `10X-INV-YYYY-NNNN`, sequential, never reused | PASS |
| INV-03 | P0 | Local | Validation: no items, due date before issue date, bad amounts | Clear errors | NOT RUN |
| INV-04 | P0 | Local | Edit draft invoice | Changes saved; sent invoices not editable as draft | NOT RUN |
| INV-05 | P0 | Local | Send invoice (email on) | Status Sent, email with PDF to contacts + billing emails | HOLD |
| INV-06 | P1 | Local | Mark sent without email | Status Sent, no email | NOT RUN |
| INV-07 | P1 | Local | Void invoice with reason | Status Void, balance excluded from totals; cannot be sent | NOT RUN |
| INV-08 | P1 | Local | Discard draft | Draft voided/removed per rules; number not reused | PASS |
| INV-09 | P1 | Local | Duplicate invoice | New draft with new number | NOT RUN |
| INV-10 | P1 | Local | Turn reminders off/on for an invoice | Respected by daily job | NOT RUN |
| INV-11 | P0 | Local | Upload an invoice PDF | Stored and viewable | HOLD |
| INV-12 | P0 | Local | Download invoice PDF (admin and client) | Correct A4 PDF; client view marks invoice Viewed | HOLD |
| INV-13 | P1 | Local | Invoice list filters (status, company, overdue) | Correct results | NOT RUN |
| INV-14 | P1 | Local | Status changes: Sent → Partly paid → Paid; past due → Overdue | Correct badges | PASS |
| INV-15 | P1 | Local | LKR and USD invoices | Correct formatting; never summed together | NOT RUN |
| INV-16 | P0 | Local | Send invoice when the PDF or email step fails | Error shown; invoice stays **Draft** (not locked as Sent) | FIXED |

## 7. Payments

| ID | Pri | Where | Test case | Expected result | Status |
|---|---|---|---|---|---|
| PAY-01 | P0 | Local | Record payment (part amount) | Balance reduced, status Partly paid, receipt email | PASS |
| PAY-02 | P0 | Local | Record payment for remaining balance | Status Paid | PASS |
| PAY-03 | P0 | Local | Payment more than balance / zero / negative | Refused | PASS |
| PAY-04 | P1 | Local | Record payment with receipt file | File stored | HOLD |
| PAY-05 | P0 | Local | Client uploads payment slip | Submission pending; admins notified | HOLD |
| PAY-06 | P0 | Local | Admin confirms slip | Payment recorded, balance updated | HOLD |
| PAY-07 | P1 | Local | Admin rejects slip with reason | Client notified, balance unchanged | HOLD |
| PAY-08 | P1 | Local | Slip upload: wrong type (renamed .exe), > 10 MB | Refused by file signature / size | NOT RUN |
| PAY-09 | P1 | Local | Payments page lists payments and pending slips | Correct | NOT RUN |

## 8. Recurring plans

| ID | Pri | Where | Test case | Expected result | Status |
|---|---|---|---|---|---|
| PLN-01 | P0 | Local | Create plan (auto mode) | Plan active, next run date shown | PASS |
| PLN-02 | P0 | Local | Daily job on billing day | One invoice per plan per month (unique `{planId, period}`) | PASS |
| PLN-03 | P1 | Local | Review mode plan | Draft created; admins emailed | PASS |
| PLN-04 | P1 | Local | Pause / resume / end plan | No invoices while paused | NOT RUN |
| PLN-05 | P1 | Local | Skip a period | That month not invoiced | NOT RUN |
| PLN-06 | P1 | Local | "Run now" | Invoice for current period, not duplicated | NOT RUN |
| PLN-07 | P2 | Local | Missed days catch-up | Missing months created once | NOT RUN |
| PLN-08 | P0 | Local | Plan whose current month is already invoiced: open Dashboard, Plans list, plan detail | Pages load; next invoice date is next month | FIXED |

## 9. Proposals

| ID | Pri | Where | Test case | Expected result | Status |
|---|---|---|---|---|---|
| PRO-01 | P0 | Local | Create proposal from template | Builder opens; number `10X-PRO-YYYY-NNN` | PASS |
| PRO-02 | P0 | Local | Edit in builder (sections, investment, timeline, payment schedule), autosave | Saved; reload keeps content | PASS |
| PRO-03 | P1 | Local | Edit after sending | Saved as new version | NOT RUN |
| PRO-04 | P0 | Local | Send proposal (no PDF attachment) | Status Sent, email logged | PASS |
| PRO-05 | P1 | Local | Send with PDF attached / download PDF | PDF correct | HOLD |
| PRO-06 | P0 | Local | Client accepts online (name, designation, agree box) | Status Accepted, admins notified | PASS |
| PRO-07 | P1 | Local | Client accepts without ticking agree | Refused | PASS (server check) |
| PRO-08 | P1 | Local | Client declines with reason | Status Declined, admins notified | NOT RUN |
| PRO-09 | P1 | Local | Admin marks accepted manually (with signed copy) | Accepted | HOLD |
| PRO-10 | P1 | Local | Create invoices from payment schedule | Draft invoices per milestone | NOT RUN |
| PRO-11 | P1 | Local | Create recurring plan from proposal | Plan linked to proposal | NOT RUN |
| PRO-12 | P1 | Local | Proposal past valid-until date + daily job | Status Expired | NOT RUN |
| PRO-13 | P1 | Local | Upload a proposal PDF | Stored and viewable | HOLD |
| PRO-14 | P1 | Local | Send proposal with PDF when the PDF step fails | Error shown; proposal status unchanged | FIXED (code) |

## 10. Reminders and emails

| ID | Pri | Where | Test case | Expected result | Status |
|---|---|---|---|---|---|
| REM-01 | P0 | Local | Reminder steps (-3, 0, +3, +7, +14 days) | Each step sent once | PASS (unit tests) |
| REM-02 | P0 | Local | No reminders for Draft, Paid or Void | None sent | PASS (unit tests + job run) |
| REM-03 | P1 | Local | After last step | Invoice flagged; admins emailed | NOT RUN |
| REM-04 | P1 | Local | Monday digest | Sent once per Monday | NOT RUN |
| EML-01 | P1 | Local | Email log lists sent / failed / queued emails | Correct | NOT RUN |
| EML-02 | P1 | Local | Resend a failed email | Retried | NOT RUN |
| EML-03 | P1 | Local | Daily email limit reached | Extra emails queued for next day | NOT RUN |
| EML-04 | P1 | Local | Edit an email template and send test | Test email uses new text | NOT RUN |
| EML-05 | P0 | Prod | Email links use `https://portal.tenxcreative.com` | `APP_URL` correct in production | NOT RUN (check first) |

## 11. Client portal

| ID | Pri | Where | Test case | Expected result | Status |
|---|---|---|---|---|---|
| CLI-01 | P0 | Local | Portal dashboard | Balance due, overdue count, recent invoices of own company only | PASS |
| CLI-02 | P0 | Local | Invoices list and detail | Only non-draft invoices of own company; correct totals | PASS |
| CLI-03 | P1 | Local | Proposals list and detail | Own company only | PASS |
| CLI-04 | P1 | Local | Statement page with date filter | Correct running balance | PASS |
| CLI-05 | P1 | Local | Statement export CSV | Downloads correct CSV | PASS |
| CLI-06 | P1 | Local | Statement export PDF | Downloads PDF (pdf-lib, no R2) | PASS |
| CLI-07 | P1 | Local | Account page: update billing address / billing emails | Saved; validation for bad emails | PASS |
| CLI-08 | P1 | Local | Bank details shown on invoice | Only what is set in Settings (never invented) | NOT RUN |

## 12. Admin — settings, reports, search, audit

| ID | Pri | Where | Test case | Expected result | Status |
|---|---|---|---|---|---|
| ADM-01 | P0 | Local | Dashboard loads with figures | Totals per currency, overdue list | FIXED |
| ADM-02 | P1 | Local | Settings: company details, bank details, tax/currency/numbering, reminder offsets | Saved; used on new documents | NOT RUN |
| ADM-03 | P1 | Local | Settings: logo upload | Logo stored and shown | HOLD |
| ADM-04 | P1 | Local | Text blocks: create / delete | Available in proposal builder | NOT RUN |
| ADM-05 | P1 | Local | Reports page + CSV exports (`/api/reports/*`) | Correct CSV | PASS |
| ADM-06 | P1 | Local | Global search (company, invoice number, proposal ref) | Finds records | PASS |
| ADM-07 | P1 | Local | Audit log lists actions with actor and time | Entries present, append-only | PASS |
| ADM-08 | P0 | Local | Super admin invites admin; admin activates | New admin can sign in | PASS |
| ADM-09 | P1 | Local | Super admin deactivates / reactivates / removes an admin | Works; removed admin cannot sign in | NOT RUN |
| ADM-10 | P0 | Local | Super admin removes an admin, then invites the same email again (any letter case) | Same user restored as Admin/Invited, old password cleared, new activation link works, old link dead | FIXED |
| ADM-11 | P1 | Local | Removed admins section: "Restore access"; cancelled admin invite: "Resend invite" | Restore sends a new link; resend re-invites | PASS (unit test) |
| ADM-12 | P1 | Local | Invite an email that is an active admin / a client contact | Clear error, nothing changes | PASS (unit test) |

---

## Last run

See `docs/TEST_RESULTS.md` for the latest results, failures found and fixes.
