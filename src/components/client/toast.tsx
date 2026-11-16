"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";
import clsx from "clsx";

type Toast = { id: number; kind: "success" | "error"; text: string };
const Ctx = createContext<{ success: (t: string) => void; error: (t: string) => void }>({ success: () => {}, error: () => {} });

export function useToast() {
  return useContext(Ctx);
}

export function Toaster({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const n = useRef(0);
  const push = useCallback((kind: Toast["kind"], text: string) => {
    const id = ++n.current;
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 7000 : 4000);
  }, []);
  const api = useRef({ success: (t: string) => push("success", t), error: (t: string) => push("error", t) });
  return (
    <Ctx.Provider value={api.current}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4 sm:items-end sm:pr-6">
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.kind === "error" ? "alert" : "status"}
            className={clsx(
              "pointer-events-auto w-full max-w-sm rounded-lg border px-4 py-3 text-sm shadow-lg",
              t.kind === "success" ? "border-emerald-200 bg-white text-ink" : "border-red-200 bg-red-50 text-red-900",
            )}
          >
            <span className={clsx("mr-2 font-bold", t.kind === "success" ? "text-emerald-600" : "text-red-600")}>{t.kind === "success" ? "✓" : "!"}</span>
            {t.text}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
