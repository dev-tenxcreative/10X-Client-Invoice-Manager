import { ObjectId } from "mongodb";
import { cols } from "../db";
import { env, optionalEnv } from "../env";
import { colomboDayStart, today, addDays } from "../dates";
import { getSettings } from "../services/settings";
import { getFileDoc, readFile } from "../storage";
import { renderEmail, type EmailVars } from "./render";
import type { EmailLogDoc } from "../types";

/*
 * One sendEmail() for the whole app. The provider is chosen by EMAIL_PROVIDER:
 *   smtp    – Gmail SMTP through Nodemailer (smtp.gmail.com:465 + App Password)
 *   console – development only; records the email in the log and prints it, does not send
 * Every email is written to emailLogs first, then delivered. Failed sends are retried by the
 * daily job up to 3 more times. Sending is throttled to Settings.emailDailyLimit per day.
 */

export const MAX_ATTEMPTS = 4; // first try + 3 retries

interface Outgoing {
  to: string[];
  cc: string[];
  subject: string;
  html: string;
  text: string;
  attachments: { filename: string; content: Uint8Array }[];
}

async function deliverSmtp(msg: Outgoing): Promise<void> {
  const nodemailer = await import("nodemailer");
  const port = Number(env("SMTP_PORT", "465"));
  const transport = nodemailer.createTransport({
    host: env("SMTP_HOST", "smtp.gmail.com"),
    port,
    secure: port === 465,
    auth: { user: env("SMTP_USER"), pass: env("SMTP_PASS").replace(/\s+/g, "") },
  });
  await transport.sendMail({
    from: env("EMAIL_FROM", env("SMTP_USER")),
    to: msg.to.join(", "),
    cc: msg.cc.length ? msg.cc.join(", ") : undefined,
    subject: msg.subject,
    html: msg.html,
    text: msg.text,
    attachments: msg.attachments.map((a) => ({ filename: a.filename, content: Buffer.from(a.content) })),
  });
}

async function deliver(msg: Outgoing): Promise<string> {
  const provider = env("EMAIL_PROVIDER", "smtp");
  if (provider === "smtp") {
    await deliverSmtp(msg);
    return "smtp";
  }
  if (provider === "console") {
    console.info(`[email:console] to=${msg.to.join(",")} cc=${msg.cc.join(",")} subject="${msg.subject}" attachments=${msg.attachments.map((a) => a.filename).join(",")}\n${msg.text}`);
    return "console";
  }
  throw new Error(`Unknown EMAIL_PROVIDER "${provider}"`);
}

async function sentToday(): Promise<number> {
  const c = await cols();
  return c.emailLogs.countDocuments({ status: "sent", sentAt: { $gte: colomboDayStart(today()) } });
}

/** Tries to deliver a logged email. Returns the updated status. */
export async function attemptDelivery(log: EmailLogDoc): Promise<EmailLogDoc["status"]> {
  const c = await cols();
  const settings = await getSettings();
  if ((await sentToday()) >= settings.emailDailyLimit) {
    await c.emailLogs.updateOne(
      { _id: log._id },
      { $set: { status: "queued", error: "Daily sending limit reached. Will send tomorrow.", nextAttemptAt: colomboDayStart(addDays(today(), 1)) } },
    );
    return "queued";
  }
  try {
    const attachments = [];
    for (const a of log.attachments) {
      const f = await getFileDoc(a.fileId);
      if (!f) throw new Error(`Attachment ${a.filename} is missing`);
      attachments.push({ filename: a.filename, content: await readFile(f) });
    }
    const provider = await deliver({ to: log.to, cc: log.cc, subject: log.subject, html: log.html, text: log.text, attachments });
    await c.emailLogs.updateOne(
      { _id: log._id },
      { $set: { status: "sent", provider, sentAt: new Date() }, $unset: { error: "", nextAttemptAt: "" }, $inc: { attempts: 1 } },
    );
    return "sent";
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[email] send failed id=${log._id} template=${log.template}: ${message}`);
    await c.emailLogs.updateOne(
      { _id: log._id },
      { $set: { status: "failed", error: message.slice(0, 500), nextAttemptAt: new Date(Date.now() + 60 * 60 * 1000) }, $inc: { attempts: 1 } },
    );
    return "failed";
  }
}

export interface SendEmailInput {
  template: string;
  to: string[];
  cc?: string[];
  vars: EmailVars;
  attachments?: { filename: string; fileId: ObjectId }[];
  related?: { type: string; id: ObjectId };
}

export async function sendEmail(input: SendEmailInput): Promise<EmailLogDoc> {
  const settings = await getSettings();
  const tpl = settings.emailTemplates[input.template];
  if (!tpl) throw new Error(`Unknown email template ${input.template}`);
  const to = [...new Set(input.to.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  const cc = [...new Set((input.cc ?? []).map((e) => e.trim().toLowerCase()).filter((e) => e && !to.includes(e)))];
  if (to.length === 0) throw new Error("Email has no recipient");
  const rendered = renderEmail(tpl, input.vars, settings);
  const log: EmailLogDoc = {
    _id: new ObjectId(),
    to,
    cc,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    template: input.template,
    attachments: input.attachments ?? [],
    status: "queued",
    attempts: 0,
    related: input.related,
    createdAt: new Date(),
  };
  const c = await cols();
  await c.emailLogs.insertOne(log);
  log.status = await attemptDelivery(log);
  return log;
}

/** Called by the daily job: retries failed (up to MAX_ATTEMPTS) and queued emails. */
export async function retryPendingEmails(limit = 50): Promise<{ retried: number; sent: number }> {
  const c = await cols();
  const due = await c.emailLogs
    .find({
      $or: [
        { status: "failed", attempts: { $lt: MAX_ATTEMPTS } },
        { status: "queued" },
      ],
      $and: [{ $or: [{ nextAttemptAt: { $exists: false } }, { nextAttemptAt: { $lte: new Date() } }] }],
    })
    .sort({ createdAt: 1 })
    .limit(limit)
    .toArray();
  let sent = 0;
  for (const log of due) if ((await attemptDelivery(log)) === "sent") sent++;
  return { retried: due.length, sent };
}

/** Admin "Resend" from the email log. Creates a fresh log entry with the same content. */
export async function resendLogged(id: ObjectId): Promise<EmailLogDoc["status"]> {
  const c = await cols();
  const old = await c.emailLogs.findOne({ _id: id });
  if (!old) throw new Error("Email not found");
  const copy: EmailLogDoc = { ...old, _id: new ObjectId(), status: "queued", attempts: 0, createdAt: new Date(), sentAt: undefined, error: undefined, nextAttemptAt: undefined };
  await c.emailLogs.insertOne(copy);
  return attemptDelivery(copy);
}

export function emailConfigured(): boolean {
  const p = optionalEnv("EMAIL_PROVIDER") ?? "smtp";
  if (p === "console") return true;
  return Boolean(optionalEnv("SMTP_USER") && optionalEnv("SMTP_PASS"));
}

/** Admin email addresses for notifications. */
export async function adminEmails(): Promise<string[]> {
  const c = await cols();
  const admins = await c.users.find({ role: { $in: ["admin", "super_admin"] }, status: "active" }, { projection: { email: 1 } }).toArray();
  return admins.map((a) => a.email);
}
