/** An error whose message is safe and friendly enough to show to the user. */
export class AppError extends Error {
  constructor(message: string, public field?: string) {
    super(message);
    this.name = "AppError";
  }
}

export class ValidationError extends AppError {
  constructor(public fieldErrors: Record<string, string>) {
    super(Object.values(fieldErrors)[0] ?? "Please check the highlighted fields.");
    this.name = "ValidationError";
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have access to this.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends AppError {
  constructor(message = "We could not find that.") {
    super(message);
    this.name = "NotFoundError";
  }
}

export type ActionResult<T = undefined> =
  | { ok: true; message?: string; data?: T; redirect?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string>; needCaptcha?: boolean };

export const GENERIC_ERROR = "Something went wrong. Please try again, or contact us if it keeps happening.";

/** Converts any thrown error into an ActionResult without leaking internals. */
export function toActionError(e: unknown, context: string): ActionResult<never> {
  if (e instanceof ValidationError) {
    return { ok: false, error: "Please check the highlighted fields.", fieldErrors: e.fieldErrors };
  }
  if (e instanceof AppError) {
    return { ok: false, error: e.message, fieldErrors: e.field ? { [e.field]: e.message } : undefined };
  }
  // Next.js uses thrown errors for redirect()/notFound(); let them propagate.
  if (e && typeof e === "object" && "digest" in e && typeof (e as { digest: unknown }).digest === "string" && (e as { digest: string }).digest.startsWith("NEXT_")) {
    throw e;
  }
  console.error(`[action:${context}]`, e);
  return { ok: false, error: GENERIC_ERROR };
}
