import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="max-w-md text-center">
        <p className="text-sm font-semibold text-brand">Not found</p>
        <h1 className="mt-1 text-2xl font-bold text-ink">We could not find that page</h1>
        <p className="mt-2 text-sm text-muted">It may have moved, or you may not have access to it.</p>
        <Link href="/" className="mt-6 inline-flex rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white">Go to my dashboard</Link>
      </div>
    </main>
  );
}
