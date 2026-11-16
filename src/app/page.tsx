import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth/session";
import { isAdminRole } from "@/lib/permissions";

export default async function Home() {
  const auth = await getAuth();
  if (!auth) redirect("/sign-in");
  redirect(isAdminRole(auth.user.role) ? "/admin" : "/portal");
}
