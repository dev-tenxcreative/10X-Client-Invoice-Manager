import Link from "next/link";
import { SetPasswordForm } from "@/components/client/auth-forms";
import { activateAction } from "@/app/actions/auth";
import { findValidToken } from "@/lib/services/users";
import { t } from "@/lib/i18n";

export const metadata = { title: "Set your password" };

export default async function ActivatePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const found = await findValidToken(token, "activation");
  if (!found) {
    return (
      <>
        <h1 className="mb-2 text-xl font-bold text-ink">{t.auth.linkInvalid}</h1>
        <p className="mb-6 text-sm text-muted">Activation links work once and expire after 72 hours. You can ask for a new one.</p>
        <Link href="/first-time" className="font-medium text-brand hover:underline">Get a new link</Link>
      </>
    );
  }
  return (
    <>
      <h1 className="mb-1 text-xl font-bold text-ink">{t.auth.setPasswordTitle}</h1>
      <p className="mb-6 text-sm text-muted">Welcome, {found.user.name}. Choose a password to finish setting up your account.</p>
      <SetPasswordForm action={activateAction} token={token} email={found.user.email} button={t.auth.savePassword} />
    </>
  );
}
