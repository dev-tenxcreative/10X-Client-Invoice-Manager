import Link from "next/link";
import { EmailRequestForm } from "@/components/client/auth-forms";
import { firstTimeAction } from "@/app/actions/auth";
import { t } from "@/lib/i18n";

export const metadata = { title: "First time here?" };

export default function FirstTimePage() {
  return (
    <>
      <h1 className="mb-4 text-xl font-bold text-ink">{t.auth.firstTimeTitle}</h1>
      <EmailRequestForm action={firstTimeAction} button="Email me a set-up link" help={t.auth.firstTimeHelp} />
      <p className="mt-6 text-sm"><Link href="/sign-in" className="text-muted hover:text-ink">← Back to sign in</Link></p>
    </>
  );
}
