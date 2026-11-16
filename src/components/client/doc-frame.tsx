"use client";

import { useEffect, useRef, useState } from "react";

/** Shows a rendered document (same HTML template as the PDF) in a sandboxed iframe. */
export function DocFrame({ html, title }: { html: string; title: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(1100);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      const doc = el.contentDocument;
      if (doc?.body) setHeight(Math.max(600, doc.documentElement.scrollHeight + 8));
    };
    el.addEventListener("load", fit);
    const id = setInterval(fit, 800);
    setTimeout(() => clearInterval(id), 5000);
    return () => {
      el.removeEventListener("load", fit);
      clearInterval(id);
    };
  }, [html]);
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-white shadow-sm">
      <iframe ref={ref} title={title} srcDoc={html} sandbox="allow-same-origin" className="block w-full min-w-[720px] border-0" style={{ height }} />
    </div>
  );
}
