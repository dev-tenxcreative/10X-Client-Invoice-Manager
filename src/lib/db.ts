import { AsyncLocalStorage } from "node:async_hooks";
import { MongoClient, type ClientSession, type Db } from "mongodb";
import { cache } from "react";
import { env, isWorkersRuntime, mongoUri } from "./env";
import type {
  AuditLogDoc, AuthTokenDoc, CompanyDoc, CounterDoc, EmailLogDoc, FileDoc, InvoiceDoc, JobRunDoc,
  MembershipDoc, PaymentDoc, PaymentSubmissionDoc, ProposalDoc, RecurringPlanDoc, ReminderLogDoc,
  SessionDoc, SettingsDoc, TextBlockDoc, UserDoc,
} from "./types";

/*
 * Cloudflare Workers cannot reuse a socket across requests, so on Workers we open one
 * MongoClient per request and share it for every query in that request:
 *  - React Server Components / Server Actions: React `cache()` scopes it to the request.
 *  - Route handlers and the cron job: `withRequestDb()` scopes it with AsyncLocalStorage.
 * In plain Node (next dev, scripts, tests) a single process-wide client is reused.
 */

const als = new AsyncLocalStorage<{ client?: Promise<MongoClient> }>();

function createClient(): Promise<MongoClient> {
  const client = new MongoClient(mongoUri(), {
    maxPoolSize: isWorkersRuntime() ? 1 : 10,
    serverSelectionTimeoutMS: 10000,
    appName: "tenx-portal",
  });
  return client.connect();
}

const g = globalThis as unknown as { __tenxMongo?: Promise<MongoClient> };

const requestClient = cache(() => createClient());

export async function getClient(): Promise<MongoClient> {
  const store = als.getStore();
  if (store) {
    store.client ??= createClient();
    return store.client;
  }
  if (!isWorkersRuntime()) {
    g.__tenxMongo ??= createClient().catch((e) => {
      g.__tenxMongo = undefined;
      throw e;
    });
    return g.__tenxMongo;
  }
  return requestClient();
}

/** Runs `fn` with one database client for its whole duration (route handlers, jobs). */
export async function withRequestDb<T>(fn: () => Promise<T>): Promise<T> {
  if (!isWorkersRuntime()) return fn();
  const store: { client?: Promise<MongoClient> } = {};
  try {
    return await als.run(store, fn);
  } finally {
    if (store.client) (await store.client).close().catch(() => {});
  }
}

export async function getDb(): Promise<Db> {
  const client = await getClient();
  return client.db(env("MONGODB_DB", "tenx_portal"));
}

export async function cols() {
  const db = await getDb();
  return {
    db,
    users: db.collection<UserDoc>("users"),
    sessions: db.collection<SessionDoc>("sessions"),
    authTokens: db.collection<AuthTokenDoc>("authTokens"),
    companies: db.collection<CompanyDoc>("companies"),
    memberships: db.collection<MembershipDoc>("memberships"),
    invoices: db.collection<InvoiceDoc>("invoices"),
    payments: db.collection<PaymentDoc>("payments"),
    paymentSubmissions: db.collection<PaymentSubmissionDoc>("paymentSubmissions"),
    recurringPlans: db.collection<RecurringPlanDoc>("recurringPlans"),
    proposals: db.collection<ProposalDoc>("proposals"),
    counters: db.collection<CounterDoc>("counters"),
    emailLogs: db.collection<EmailLogDoc>("emailLogs"),
    reminderLogs: db.collection<ReminderLogDoc>("reminderLogs"),
    files: db.collection<FileDoc>("files"),
    settings: db.collection<SettingsDoc>("settings"),
    auditLogs: db.collection<AuditLogDoc>("auditLogs"),
    textBlocks: db.collection<TextBlockDoc>("textBlocks"),
    rateLimits: db.collection<{ key: string; at: Date }>("rateLimits"),
    jobRuns: db.collection<JobRunDoc>("jobRuns"),
  };
}

export type Cols = Awaited<ReturnType<typeof cols>>;

/** Runs `fn` inside a MongoDB transaction (requires a replica set, which Atlas always is). */
export async function withTransaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
  const client = await getClient();
  const session = client.startSession();
  try {
    let result: T | undefined;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result as T;
  } finally {
    await session.endSession();
  }
}
