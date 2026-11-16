"use client";

import { createContext, useContext, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { useToast } from "./toast";
import { buttonClass, inputClass, labelClass } from "../ui";
import type { ActionResult } from "@/lib/errors";

type Errors = Record<string, string>;
const ErrorsCtx = createContext<Errors>({});
const PendingCtx = createContext(false);

export interface ConfirmSpec {
  title: string;
  summary?: React.ReactNode;
  confirmLabel?: string;
  danger?: boolean;
}

/**
 * Calls a server action with the form's data without resetting the form, so typed data is
 * never lost. Shows inline field errors and a toast. Optional confirmation with a summary.
 */
export function ActionForm({
  action,
  children,
  className,
  confirm,
  onSuccess,
  resetOnSuccess,
  id,
}: {
  action: (fd: FormData) => Promise<ActionResult<unknown>>;
  children: React.ReactNode;
  className?: string;
  confirm?: ConfirmSpec | ((fd: FormData) => ConfirmSpec | null);
  onSuccess?: (res: Extract<ActionResult<unknown>, { ok: true }>) => void;
  resetOnSuccess?: boolean;
  id?: string;
}) {
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Errors>({});
  const [asking, setAsking] = useState<{ fd: FormData; spec: ConfirmSpec } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const toast = useToast();
  const router = useRouter();

  const run = (fd: FormData) =>
    start(async () => {
      try {
        const res = await action(fd);
        if (res.ok) {
          setErrors({});
          if (res.message) toast.success(res.message);
          if (resetOnSuccess) formRef.current?.reset();
          onSuccess?.(res);
          if (res.redirect) router.push(res.redirect);
          else router.refresh();
        } else {
          setErrors(res.fieldErrors ?? {});
          toast.error(res.error);
          const first = res.fieldErrors && Object.keys(res.fieldErrors)[0];
          if (first) formRef.current?.querySelector<HTMLElement>(`[name="${CSS.escape(first)}"]`)?.focus();
        }
      } catch (e) {
        console.error(e);
        toast.error("We could not reach the server. Check your connection and try again.");
      }
    });

  return (
    <ErrorsCtx.Provider value={errors}>
      <PendingCtx.Provider value={pending}>
        <form
          id={id}
          ref={formRef}
          // POST so that a submit before hydration can never put field values in the URL.
          method="post"
          noValidate
          className={className}
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
            if (submitter?.name) fd.set(submitter.name, submitter.value);
            const spec = typeof confirm === "function" ? confirm(fd) : confirm;
            if (spec) setAsking({ fd, spec });
            else run(fd);
          }}
        >
          {children}
        </form>
        {asking && (
          <ConfirmDialog
            spec={asking.spec}
            onCancel={() => setAsking(null)}
            onConfirm={() => {
              const fd = asking.fd;
              setAsking(null);
              run(fd);
            }}
          />
        )}
      </PendingCtx.Provider>
    </ErrorsCtx.Provider>
  );
}

export function ConfirmDialog({ spec, onCancel, onConfirm }: { spec: ConfirmSpec; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="confirm-title"
      onKeyDown={(e) => e.key === "Escape" && onCancel()}>
      <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
        <h2 id="confirm-title" className="text-lg font-semibold text-ink">{spec.title}</h2>
        {spec.summary && <div className="mt-2 text-sm text-muted">{spec.summary}</div>}
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className={buttonClass("secondary")} onClick={onCancel} autoFocus>Cancel</button>
          <button type="button" className={buttonClass(spec.danger ? "dark" : "primary")} onClick={onConfirm}>{spec.confirmLabel ?? "Confirm"}</button>
        </div>
      </div>
    </div>
  );
}

/** False until React has hydrated, so submit buttons cannot fire a native form submit. */
export function useHydrated() {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return ready;
}

export function useFieldError(name: string) {
  return useContext(ErrorsCtx)[name];
}

export function SubmitButton({ children, variant = "primary", className, name, value, pendingText }: { children: React.ReactNode; variant?: "primary" | "secondary" | "danger" | "dark" | "ghost"; className?: string; name?: string; value?: string; pendingText?: string }) {
  const pending = useContext(PendingCtx);
  const ready = useHydrated();
  return (
    <button type="submit" name={name} value={value} disabled={pending || !ready} className={buttonClass(variant, className)} aria-busy={pending}>
      {pending && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />}
      {pending && pendingText ? pendingText : children}
    </button>
  );
}

type FieldProps = {
  name: string;
  label: string;
  hint?: React.ReactNode;
  className?: string;
  required?: boolean;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "name">;

export function Field({ name, label, hint, className, required, ...input }: FieldProps) {
  const err = useFieldError(name);
  const id = `f-${name}`;
  return (
    <div className={className}>
      <label htmlFor={id} className={labelClass}>
        {label}
        {required && <span className="text-brand"> *</span>}
      </label>
      <input id={id} name={name} aria-invalid={Boolean(err)} aria-describedby={err ? `${id}-err` : hint ? `${id}-hint` : undefined} className={inputClass} required={required} {...input} />
      {hint && !err && <p id={`${id}-hint`} className="mt-1 text-xs text-muted">{hint}</p>}
      {err && <p id={`${id}-err`} className="mt-1 text-xs font-medium text-red-700">{err}</p>}
    </div>
  );
}

export function TextArea({ name, label, hint, className, rows = 3, ...rest }: { name: string; label: string; hint?: string; className?: string; rows?: number } & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "name">) {
  const err = useFieldError(name);
  const id = `f-${name}`;
  return (
    <div className={className}>
      <label htmlFor={id} className={labelClass}>{label}</label>
      <textarea id={id} name={name} rows={rows} aria-invalid={Boolean(err)} className={inputClass} {...rest} />
      {hint && !err && <p className="mt-1 text-xs text-muted">{hint}</p>}
      {err && <p className="mt-1 text-xs font-medium text-red-700">{err}</p>}
    </div>
  );
}

export function Select({ name, label, options, className, hint, ...rest }: { name: string; label: string; options: { value: string; label: string }[]; className?: string; hint?: string } & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "name">) {
  const err = useFieldError(name);
  const id = `f-${name}`;
  return (
    <div className={className}>
      <label htmlFor={id} className={labelClass}>{label}</label>
      <select id={id} name={name} aria-invalid={Boolean(err)} className={clsx(inputClass, "pr-8")} {...rest}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      {hint && !err && <p className="mt-1 text-xs text-muted">{hint}</p>}
      {err && <p className="mt-1 text-xs font-medium text-red-700">{err}</p>}
    </div>
  );
}

export function Checkbox({ name, label, defaultChecked, hint, value = "on" }: { name: string; label: React.ReactNode; defaultChecked?: boolean; hint?: string; value?: string }) {
  const err = useFieldError(name);
  return (
    <div>
      <label className="flex cursor-pointer items-start gap-2 text-sm text-ink">
        <input type="checkbox" name={name} value={value} defaultChecked={defaultChecked} className="mt-0.5 h-4 w-4 rounded border-zinc-300 accent-brand" />
        <span>{label}</span>
      </label>
      {hint && <p className="ml-6 mt-0.5 text-xs text-muted">{hint}</p>}
      {err && <p className="ml-6 mt-1 text-xs font-medium text-red-700">{err}</p>}
    </div>
  );
}

export function FileField({ name, label, hint, accept = ".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png", required }: { name: string; label: string; hint?: string; accept?: string; required?: boolean }) {
  const err = useFieldError(name);
  return (
    <div>
      <label htmlFor={`f-${name}`} className={labelClass}>{label}{required && <span className="text-brand"> *</span>}</label>
      <input id={`f-${name}`} type="file" name={name} accept={accept} aria-invalid={Boolean(err)}
        className="block w-full text-sm text-muted file:mr-3 file:rounded-md file:border-0 file:bg-zinc-100 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-ink hover:file:bg-zinc-200" />
      <p className="mt-1 text-xs text-muted">{hint ?? "PDF, JPG or PNG, up to 10 MB."}</p>
      {err && <p className="mt-1 text-xs font-medium text-red-700">{err}</p>}
    </div>
  );
}

/** A one-button form for simple actions (send, archive, run now…). */
export function ActionButton({
  action,
  fields,
  children,
  variant = "secondary",
  confirm,
  className,
}: {
  action: (fd: FormData) => Promise<ActionResult<unknown>>;
  fields?: Record<string, string>;
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "danger" | "dark" | "ghost";
  confirm?: ConfirmSpec;
  className?: string;
}) {
  return (
    <ActionForm action={action} confirm={confirm} className={clsx("inline", className)}>
      {Object.entries(fields ?? {}).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <SubmitButton variant={variant}>{children}</SubmitButton>
    </ActionForm>
  );
}
