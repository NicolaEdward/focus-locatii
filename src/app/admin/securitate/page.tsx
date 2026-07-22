import { redirect } from "next/navigation";
import { AdminHeader } from "@/components/admin/AdminHeader";
import { SecurityWorkspace } from "@/components/admin/SecurityWorkspace";
import { getAuthSession } from "@/lib/auth";
import { getMfaStatus } from "@/lib/mfa";
import { listAuthSessions } from "@/lib/auth-sessions";

export const dynamic = "force-dynamic";

export default async function SecurityPage() {
  const session = await getAuthSession();
  if (!session) redirect("/admin/login");
  const [mfa, sessions] = await Promise.all([getMfaStatus(session.id), listAuthSessions(session.id, session.sessionId)]);
  return <><AdminHeader session={session} /><SecurityWorkspace initialState={{ mfa, sessions }} /></>;
}
