import { Logo } from "@/components/ui";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center"><Logo /></div>
        <div className="overflow-hidden rounded-xl border border-line bg-white shadow-sm">
          <div className="h-1 bg-brand" />
          <div className="p-6 sm:p-8">{children}</div>
        </div>
        <p className="mt-6 text-center text-xs text-muted">10X Creative (Pvt) Ltd · Client Portal</p>
      </div>
    </main>
  );
}
