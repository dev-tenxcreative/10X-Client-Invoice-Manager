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
 *  - Every request: custom-worker.ts runs the whole fetch inside this AsyncLocalStorage scope
 *    (shared through globalThis because the worker entry is bundled separately), so pages,
 *    Server Actions and route handlers all reuse one client.
 *  - Fallback: React `cache()`. It only memoises during a Server Component render, NOT in
 *    Server Actions, where it opened a new client on every call. Several clients exhaust the
 *    Workers limit of 6 open connections per request and MongoDB server selection times out.
 * In plain Node (next dev, scripts, tests) a single process-wide client is reused.
 */

type DbScope = { client?: Promise<MongoClient> };

const g = globalThis as unknown as { __tenxMongo?: Promise<MongoClient>; __tenxDbScope?: AsyncLocalStorage<DbScope> };
const als = (g.__tenxDbScope ??= new AsyncLocalStorage<DbScope>());

function createClient(): Promise<MongoClient> {
  const workers = isWorkersRuntime();
  const client = new MongoClient(mongoUri(), {
    maxPoolSize: workers ? 1 : 10,
    // Streaming monitoring adds an extra RTT socket per replica-set member; polling keeps a
    // Workers request to one monitor socket per member plus one pool socket, leaving room
    // for SMTP / other outbound connections under the 6-connection limit.
    ...(workers && { serverMonitoringMode: "poll" as const }),
    serverSelectionTimeoutMS: 10000,
    appName: "tenx-portal",
  });
  return client.connect();
}

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
  // Already inside the request-wide scope from custom-worker.ts: share its client.
  if (als.getStore()) return fn();
  const store: DbScope = {};
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
