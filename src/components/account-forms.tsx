import { Card } from "./ui";
import { ActionButton, ActionForm, Field, SubmitButton } from "./client/action-form";
import { PasswordPair } from "./client/auth-forms";
import { changePasswordAction, signOutAllAction, updateProfileAction } from "@/app/actions/auth";
import type { UserDoc } from "@/lib/types";

/** Shared by the admin profile and the client account page. */
export function AccountForms({ user, readOnly }: { user: UserDoc; readOnly?: boolean }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Your details">
        <ActionForm action={updateProfileAction} className="space-y-4">
          <Field name="name" label="Full name" defaultValue={user.name} required disabled={readOnly} />
          <Field name="phone" label="Phone" defaultValue={user.phone} disabled={readOnly} />
          <Field name="email" label="Email" defaultValue={user.email} disabled hint="Contact 10X Creative to change your email." />
          {!readOnly && <SubmitButton>Save details</SubmitButton>}
        </ActionForm>
      </Card>
      {!readOnly && (
        <Card title="Change password">
          <ActionForm action={changePasswordAction} className="space-y-4" resetOnSuccess>
            <PasswordPair currentField />
            <SubmitButton>Change password</SubmitButton>
          </ActionForm>
        </Card>
      )}
      {!readOnly && (
        <Card title="Sign out of all devices">
          <p className="mb-3 text-sm text-muted">Use this if you signed in on a shared or lost device.</p>
          <ActionButton action={signOutAllAction} variant="danger" confirm={{ title: "Sign out everywhere?", summary: "You will be signed out on every device, including this one.", danger: true }}>Sign out of all devices</ActionButton>
        </Card>
      )}
    </div>
  );
}
