import Link from "next/link";
import { SetPasswordForm } from "@/components/client/auth-forms";
import { resetPasswordAction } from "@/app/actions/auth";
import { findValidToken } from "@/lib/services/users";
import { t } from "@/lib/i18n";

export const metadata = { title: "Choose a new password" };

export default async function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const found = await findValidToken(token, "reset");
  if (!found) {
    return (
      <>
        <h1 className="mb-2 text-xl font-bold text-ink">{t.auth.linkInvalid}</h1>
        <p className="mb-6 text-sm text-muted">Reset links work once and expire after 60 minutes.</p>
        <Link href="/forgot-password" className="font-medium text-brand hover:underline">Ask for a new link</Link>
      </>
    );
  }
  return (
    <>
      <h1 className="mb-1 text-xl font-bold text-ink">Choose a new password</h1>
      <p className="mb-6 text-sm text-muted">After saving, you will be signed out of all other devices.</p>
      <SetPasswordForm action={resetPasswordAction} token={token} email={found.user.email} button="Save new password" />
    </>
  );
}
