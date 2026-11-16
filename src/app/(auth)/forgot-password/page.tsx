import Link from "next/link";
import { EmailRequestForm } from "@/components/client/auth-forms";
import { forgotPasswordAction } from "@/app/actions/auth";
import { t } from "@/lib/i18n";

export const metadata = { title: "Reset password" };

export default function ForgotPage() {
  return (
    <>
      <h1 className="mb-4 text-xl font-bold text-ink">{t.auth.forgotTitle}</h1>
      <EmailRequestForm action={forgotPasswordAction} button="Email me a reset link" help={t.auth.forgotHelp} />
      <p className="mt-6 text-sm"><Link href="/sign-in" className="text-muted hover:text-ink">← Back to sign in</Link></p>
    </>
  );
}
