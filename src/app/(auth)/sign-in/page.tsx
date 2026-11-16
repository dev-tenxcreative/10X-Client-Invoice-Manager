import { redirect } from "next/navigation";
import { SignInForm } from "@/components/client/auth-forms";
import { signInAction } from "@/app/actions/auth";
import { getAuth } from "@/lib/auth/session";
import { isAdminRole } from "@/lib/permissions";
import { optionalEnv } from "@/lib/env";
import { t } from "@/lib/i18n";

export const metadata = { title: "Sign in" };

export default async function SignInPage() {
  const auth = await getAuth();
  if (auth) redirect(isAdminRole(auth.user.role) ? "/admin" : "/portal");
  return (
    <>
      <h1 className="mb-1 text-xl font-bold text-ink">{t.auth.signInTitle}</h1>
      <p className="mb-6 text-sm text-muted">Proposals, invoices and payments in one place.</p>
      <SignInForm action={signInAction} turnstileSiteKey={optionalEnv("TURNSTILE_SITE_KEY")} />
    </>
  );
}
