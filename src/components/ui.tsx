import Link from "next/link";
import clsx from "clsx";
import { formatMoney } from "@/lib/money";

export { clsx as cx };

type BtnVariant = "primary" | "secondary" | "ghost" | "danger" | "dark";
const btnBase =
  "inline-flex items-center justify-center gap-2 rounded-md text-sm font-semibold transition-colors disabled:opacity-60 disabled:cursor-not-allowed min-h-10 px-4 whitespace-nowrap";
const btnVariants: Record<BtnVariant, string> = {
  primary: "bg-brand text-white hover:bg-brand-dark",
  secondary: "bg-white text-ink border border-line hover:bg-zinc-50",
  ghost: "text-ink hover:bg-zinc-100",
  danger: "bg-white text-red-700 border border-red-200 hover:bg-red-50",
  dark: "bg-ink text-white hover:bg-ink-soft",
};

export function buttonClass(variant: BtnVariant = "primary", extra?: string) {
  return clsx(btnBase, btnVariants[variant], extra);
}

export function LinkButton({ href, variant = "primary", className, children, ...rest }: { href: string; variant?: BtnVariant; className?: string; children: React.ReactNode } & Omit<React.ComponentProps<typeof Link>, "href">) {
  return (
    <Link href={href} className={buttonClass(variant, className)} {...rest}>
      {children}
    </Link>
  );
}

export function Card({ className, children, title, actions }: { className?: string; children: React.ReactNode; title?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className={clsx("rounded-lg border border-line bg-white", className)}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
          {title && <h2 className="text-sm font-semibold text-ink">{title}</h2>}
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
      )}
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}

export function PageHeader({ title, description, actions, back }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="mb-6">
      {back && (
        <Link href={back.href} className="mb-2 inline-flex text-sm text-muted hover:text-ink">
          ← {back.label}
        </Link>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-ink">{title}</h1>
          {description && <p className="mt-1 text-sm text-muted">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function EmptyState({ title, text, action }: { title: string; text: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-zinc-300 bg-white px-6 py-10 text-center">
      <p className="font-semibold text-ink">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted">{text}</p>
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

const TONES = {
  gray: "bg-zinc-100 text-zinc-700 ring-zinc-200",
  blue: "bg-sky-50 text-sky-800 ring-sky-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  green: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  red: "bg-red-50 text-red-800 ring-red-200",
  violet: "bg-violet-50 text-violet-800 ring-violet-200",
};
export type Tone = keyof typeof TONES;

const DOT: Record<Tone, string> = { gray: "bg-zinc-400", blue: "bg-sky-500", amber: "bg-amber-500", green: "bg-emerald-500", red: "bg-red-500", violet: "bg-violet-500" };

/** Status badges always use colour and text together. */
export function Badge({ tone = "gray", children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <span className={clsx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset whitespace-nowrap", TONES[tone])}>
      <span className={clsx("h-1.5 w-1.5 rounded-full", DOT[tone])} aria-hidden />
      {children}
    </span>
  );
}

const STATUS_TONE: Record<string, Tone> = {
  draft: "gray", sent: "blue", viewed: "violet", partially_paid: "amber", paid: "green", overdue: "red", void: "gray",
  accepted: "green", declined: "red", expired: "gray",
  active: "green", invited: "amber", deactivated: "gray", archived: "gray", paused: "amber", ended: "gray",
  pending: "amber", confirmed: "green", rejected: "red", queued: "amber", failed: "red",
};
const STATUS_TEXT: Record<string, string> = {
  draft: "Draft", sent: "Sent", viewed: "Viewed", partially_paid: "Partially paid", paid: "Paid", overdue: "Overdue", void: "Void",
  accepted: "Accepted", declined: "Declined", expired: "Expired",
  active: "Active", invited: "Invited", deactivated: "Deactivated", archived: "Archived", paused: "Paused", ended: "Ended",
  pending: "Awaiting review", confirmed: "Confirmed", rejected: "Rejected", queued: "Queued", failed: "Failed",
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <Badge tone={STATUS_TONE[status] ?? "gray"}>{label ?? STATUS_TEXT[status] ?? status}</Badge>;
}

export function Money({ amount, currency, className }: { amount: number; currency: string; className?: string }) {
  return <span className={clsx("num", className)}>{formatMoney(amount, currency)}</span>;
}

/** Amounts per currency, never mixed. */
export function MoneyList({ values, empty = "—" }: { values: Record<string, number>; empty?: string }) {
  const entries = Object.entries(values).filter(([, v]) => v !== 0);
  if (entries.length === 0) return <span className="num">{empty}</span>;
  return (
    <span className="flex flex-col">
      {entries.map(([cur, v]) => (
        <span key={cur} className="num">{formatMoney(v, cur)}</span>
      ))}
    </span>
  );
}

export function Stat({ label, children, tone }: { label: string; children: React.ReactNode; tone?: "red" | "default" }) {
  return (
    <div className="rounded-lg border border-line bg-white p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className={clsx("mt-1 text-lg font-bold", tone === "red" ? "text-brand" : "text-ink")}>{children}</div>
    </div>
  );
}

export function Tabs({ tabs, current }: { tabs: { key: string; label: string; href: string; count?: number }[]; current: string }) {
  return (
    <nav className="-mx-1 mb-4 flex gap-1 overflow-x-auto overflow-y-hidden border-b border-line px-1" aria-label="Tabs">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={t.key === current ? "page" : undefined}
          className={clsx(
            "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium",
            t.key === current ? "border-brand text-ink" : "border-transparent text-muted hover:text-ink",
          )}
        >
          {t.label}
          {t.count !== undefined && <span className="ml-1.5 rounded-full bg-zinc-100 px-1.5 text-xs text-muted">{t.count}</span>}
        </Link>
      ))}
    </nav>
  );
}

export function Table({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={clsx("overflow-x-auto rounded-lg border border-line bg-white", className)}>
      <table className="w-full min-w-[640px] text-left text-sm">{children}</table>
    </div>
  );
}
export function Th({ children, right, className }: { children?: React.ReactNode; right?: boolean; className?: string }) {
  return <th scope="col" className={clsx("border-b border-line bg-zinc-50 px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted", right && "text-right", className)}>{children}</th>;
}
export function Td({ children, right, className, colSpan }: { children?: React.ReactNode; right?: boolean; className?: string; colSpan?: number }) {
  return <td colSpan={colSpan} className={clsx("border-b border-line px-3 py-2.5 align-top", right && "text-right num", className)}>{children}</td>;
}

export function DL({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => (
        <div key={k}>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted">{k}</dt>
          <dd className="mt-0.5 text-sm text-ink break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={clsx("inline-flex items-center gap-2", className)}>
      <svg viewBox="0 0 128 60" className="h-7 w-auto" aria-hidden>
        <text x="0" y="50" fontFamily="Inter, Arial, sans-serif" fontWeight="900" fontSize="56" letterSpacing="-4" fill="#D71920">10</text>
        <path d="M68 10 H82 L114 58 H100 Z" fill="#1F2128" />
        <path d="M112 0 H126 L88 60 H74 Z" fill="#D71920" />
      </svg>
      <span className="text-base font-extrabold tracking-tight text-ink">Creative</span>
    </span>
  );
}

export const inputClass =
  "block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-ink placeholder:text-zinc-400 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:bg-zinc-50 disabled:text-muted aria-[invalid=true]:border-red-500";
export const labelClass = "mb-1 block text-sm font-medium text-ink";
