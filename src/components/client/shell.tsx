"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import clsx from "clsx";
import { Logo, inputClass } from "../ui";
import { SignOutButton } from "./auth-forms";
import type { ActionResult } from "@/lib/errors";

export interface NavItem {
  href: string;
  label: string;
  badge?: number;
}

export function Shell({
  nav,
  children,
  user,
  signOut,
  search,
  newMenu,
  topSlot,
  banner,
  accountHref,
}: {
  nav: NavItem[];
  children: React.ReactNode;
  user: { name: string; email: string; roleLabel: string };
  signOut: () => Promise<ActionResult>;
  search?: boolean;
  newMenu?: { href: string; label: string }[];
  topSlot?: React.ReactNode;
  banner?: React.ReactNode;
  accountHref: string;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);

  const active = (href: string) => (href === "/admin" || href === "/portal" ? pathname === href : pathname.startsWith(href));

  const sidebar = (
    <nav aria-label="Main" className="flex h-full flex-col">
      <div className="flex h-16 items-center border-b border-line px-5">
        <Link href={nav[0]?.href ?? "/"}><Logo /></Link>
      </div>
      <ul className="flex-1 space-y-0.5 overflow-y-auto p-3">
        {nav.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={active(item.href) ? "page" : undefined}
              className={clsx(
                "flex items-center justify-between rounded-md px-3 py-2 text-sm font-medium",
                active(item.href) ? "bg-brand-soft text-brand" : "text-ink-soft hover:bg-zinc-100 hover:text-ink",
              )}
            >
              {item.label}
              {item.badge ? <span className="rounded-full bg-brand px-1.5 text-xs font-semibold text-white">{item.badge}</span> : null}
            </Link>
          </li>
        ))}
      </ul>
      <div className="border-t border-line p-4 text-sm">
        <div className="truncate font-semibold text-ink">{user.name}</div>
        <div className="truncate text-xs text-muted">{user.email}</div>
        <div className="mt-0.5 text-xs text-muted">{user.roleLabel}</div>
        <div className="mt-3 flex gap-3">
          <Link href={accountHref} className="text-xs font-medium text-ink hover:text-brand">My account</Link>
          <SignOutButton action={signOut} className="text-xs font-medium text-muted hover:text-brand" />
        </div>
      </div>
    </nav>
  );

  return (
    <div className="min-h-dvh lg:pl-64">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-line bg-white lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-white shadow-xl">{sidebar}</aside>
        </div>
      )}
      <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-white/95 px-4 backdrop-blur sm:px-6">
        <button type="button" className="-ml-1 rounded-md p-2 text-ink hover:bg-zinc-100 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden><path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
        </button>
        <div className="lg:hidden"><Logo /></div>
        {search && <GlobalSearch />}
        <div className="ml-auto flex items-center gap-2">
          {topSlot}
          {newMenu && <NewMenu items={newMenu} />}
        </div>
      </header>
      {banner}
      <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:py-8">{children}</main>
    </div>
  );
}

function GlobalSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  return (
    <form
      role="search"
      className="hidden max-w-sm flex-1 md:block"
      onSubmit={(e) => {
        e.preventDefault();
        if (q.trim()) router.push(`/admin/search?q=${encodeURIComponent(q.trim())}`);
      }}
    >
      <label htmlFor="global-search" className="sr-only">Search clients, invoices and proposals</label>
      <input id="global-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search client, invoice or proposal…" className={inputClass} />
    </form>
  );
}

function NewMenu({ items }: { items: { href: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  return (
    <div className="relative" ref={ref} onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        className="inline-flex min-h-10 items-center gap-1 rounded-md bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-dark">
        + New
      </button>
      {open && (
        <div role="menu" className="absolute right-0 mt-2 w-48 overflow-hidden rounded-md border border-line bg-white py-1 shadow-lg">
          {items.map((i) => (
            <Link key={i.href} role="menuitem" href={i.href} onClick={() => setOpen(false)} className="block px-4 py-2 text-sm text-ink hover:bg-zinc-50">{i.label}</Link>
          ))}
        </div>
      )}
    </div>
  );
}
