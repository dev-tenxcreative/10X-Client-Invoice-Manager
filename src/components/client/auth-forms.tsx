"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Script from "next/script";
import clsx from "clsx";
import { ActionForm, Field, SubmitButton, useFieldError, useHydrated } from "./action-form";
import { useToast } from "./toast";
import { inputClass, labelClass } from "../ui";
import { passwordScore, PASSWORD_MIN } from "@/lib/auth/password-policy";
import { t } from "@/lib/i18n";
import type { ActionResult } from "@/lib/errors";

declare global {
  interface Window {
    turnstile?: { render: (el: HTMLElement, opts: Record<string, unknown>) => string; reset: (id?: string) => void };
  }
}

export function SignInForm({ action, turnstileSiteKey }: { action: (fd: FormData) => Promise<ActionResult>; turnstileSiteKey?: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [captcha, setCaptcha] = useState(false);
  const [show, setShow] = useState(false);
  const ready = useHydrated();
  const router = useRouter();
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);

  useEffect(() => {
    if (!captcha || !turnstileSiteKey || !box.current) return;
    const tryRender = () => {
      if (window.turnstile && box.current && !widget.current) {
        widget.current = window.turnstile.render(box.current, { sitekey: turnstileSiteKey });
      } else if (!widget.current) setTimeout(tryRender, 300);
    };
    tryRender();
  }, [captcha, turnstileSiteKey]);

  return (
    <form
      method="post"
      noValidate
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => {
          const res = await action(fd);
          if (res.ok) router.push(res.redirect ?? "/");
          else {
            setError(res.error);
            if (res.needCaptcha) setCaptcha(true);
            if (widget.current) window.turnstile?.reset(widget.current);
          }
        });
      }}
    >
      {captcha && turnstileSiteKey && <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" strategy="afterInteractive" />}
      {error && <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}
      <div>
        <label htmlFor="email" className={labelClass}>{t.auth.email}</label>
        <input id="email" name="email" type="email" autoComplete="email" required className={inputClass} />
      </div>
      <div>
        <div className="flex items-center justify-between">
          <label htmlFor="password" className={labelClass}>{t.auth.password}</label>
          <button type="button" className="mb-1 text-xs font-medium text-muted hover:text-ink" onClick={() => setShow((s) => !s)} aria-pressed={show}>{show ? "Hide" : "Show"}</button>
        </div>
        <input id="password" name="password" type={show ? "text" : "password"} autoComplete="current-password" required className={inputClass} />
      </div>
      {captcha && turnstileSiteKey && <div ref={box} />}
      <button type="submit" disabled={pending || !ready} className="inline-flex min-h-11 w-full items-center justify-center rounded-md bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60">
        {pending ? "Signing in…" : t.auth.signIn}
      </button>
      <div className="flex flex-col gap-2 pt-1 text-sm sm:flex-row sm:justify-between">
        <Link href="/first-time" className="font-medium text-brand hover:underline">{t.auth.firstTime}</Link>
        <Link href="/forgot-password" className="text-muted hover:text-ink">{t.auth.forgot}</Link>
      </div>
    </form>
  );
}

export function EmailRequestForm({ action, button, help }: { action: (fd: FormData) => Promise<ActionResult>; button: string; help: string }) {
  const [sent, setSent] = useState<string | null>(null);
  if (sent) return <div role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{sent}</div>;
  return (
    <ActionForm action={action} className="space-y-4" onSuccess={(r) => setSent(r.message ?? "Done.")}>
      <p className="text-sm text-muted">{help}</p>
      <Field name="email" label={t.auth.email} type="email" autoComplete="email" required />
      <SubmitButton className="w-full">{button}</SubmitButton>
    </ActionForm>
  );
}

const STRENGTH = ["Too weak", "Weak", "Fair", "Good", "Strong"];

export function PasswordPair({ email, currentField }: { email?: string; currentField?: boolean }) {
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const errPw = useFieldError("password");
  const errConfirm = useFieldError("confirm");
  const errCurrent = useFieldError("current");
  const score = passwordScore(pw);
  const mismatch = confirm.length > 0 && confirm !== pw;
  return (
    <div className="space-y-4">
      {email && (
        <div>
          <label className={labelClass} htmlFor="ro-email">{t.auth.email}</label>
          <input id="ro-email" value={email} readOnly className={clsx(inputClass, "bg-zinc-50 text-muted")} />
        </div>
      )}
      {currentField && (
        <div>
          <label className={labelClass} htmlFor="current">Current password</label>
          <input id="current" name="current" type={show ? "text" : "password"} autoComplete="current-password" className={inputClass} aria-invalid={Boolean(errCurrent)} />
          {errCurrent && <p className="mt-1 text-xs font-medium text-red-700">{errCurrent}</p>}
        </div>
      )}
      <div>
        <div className="flex items-center justify-between">
          <label className={labelClass} htmlFor="password">{t.auth.newPassword}</label>
          <button type="button" className="mb-1 text-xs font-medium text-muted hover:text-ink" onClick={() => setShow((s) => !s)} aria-pressed={show}>{show ? "Hide" : "Show"}</button>
        </div>
        <input id="password" name="password" type={show ? "text" : "password"} autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} className={inputClass} aria-invalid={Boolean(errPw)} aria-describedby="pw-meter" minLength={PASSWORD_MIN} />
        <div id="pw-meter" className="mt-2" aria-live="polite">
          <div className="flex gap-1" aria-hidden>
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className={clsx("h-1.5 flex-1 rounded-full", pw && i < score ? (score <= 1 ? "bg-red-500" : score === 2 ? "bg-amber-500" : "bg-emerald-500") : "bg-zinc-200")} />
            ))}
          </div>
          <p className="mt-1 text-xs text-muted">{pw ? `Strength: ${STRENGTH[score]}. ` : ""}{t.auth.passwordHint}</p>
        </div>
        {errPw && <p className="mt-1 text-xs font-medium text-red-700">{errPw}</p>}
      </div>
      <div>
        <label className={labelClass} htmlFor="confirm">{t.auth.confirmPassword}</label>
        <input id="confirm" name="confirm" type={show ? "text" : "password"} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={inputClass} aria-invalid={mismatch || Boolean(errConfirm)} />
        {(mismatch || errConfirm) && <p className="mt-1 text-xs font-medium text-red-700">{errConfirm ?? "The two passwords do not match yet."}</p>}
      </div>
    </div>
  );
}

export function SetPasswordForm({ action, token, email, button }: { action: (fd: FormData) => Promise<ActionResult>; token: string; email: string; button: string }) {
  return (
    <ActionForm action={action} className="space-y-5">
      <input type="hidden" name="token" value={token} />
      <PasswordPair email={email} />
      <SubmitButton className="w-full">{button}</SubmitButton>
    </ActionForm>
  );
}

export function SignOutButton({ action, className }: { action: () => Promise<ActionResult>; className?: string }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      className={className}
      onClick={() => start(async () => {
        const r = await action();
        if (r.ok) router.push(r.redirect ?? "/sign-in");
        else toast.error(r.error);
      })}
    >
      {t.nav.signOut}
    </button>
  );
}
