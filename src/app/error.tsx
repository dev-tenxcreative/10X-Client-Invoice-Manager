"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-[60dvh] items-center justify-center px-4">
      <div className="max-w-md text-center">
        <p className="text-sm font-semibold text-brand">Something went wrong</p>
        <h1 className="mt-1 text-2xl font-bold text-ink">We could not load this page</h1>
        <p className="mt-2 text-sm text-muted">Please try again. If it keeps happening, contact 10X Creative.</p>
        <button onClick={reset} className="mt-6 inline-flex rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white">Try again</button>
      </div>
    </main>
  );
}
