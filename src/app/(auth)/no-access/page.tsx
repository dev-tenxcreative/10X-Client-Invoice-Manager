import { SignOutButton } from "@/components/client/auth-forms";
import { signOutAction } from "@/app/actions/auth";

export default function NoAccess() {
  return (
    <>
      <h1 className="mb-2 text-xl font-bold text-ink">Your account is not linked to a company yet</h1>
      <p className="mb-6 text-sm text-muted">Please contact 10X Creative and we will set this up for you.</p>
      <SignOutButton action={signOutAction} className="font-medium text-brand hover:underline" />
    </>
  );
}
