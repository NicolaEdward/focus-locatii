import { redirect } from "next/navigation";
import { AdminHeader } from "@/components/admin/AdminHeader";
import { WorkplaceOnboarding } from "@/components/admin/WorkplaceOnboarding";
import { getAuthSession } from "@/lib/auth";
import { onboardingState } from "@/lib/workplace-onboarding";
import { workplaceGuide } from "@/lib/workplace-guide";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const session = await getAuthSession();
  if (!session) redirect("/admin/login");
  return <><AdminHeader session={session} /><WorkplaceOnboarding name={session.name} guide={workplaceGuide(session.role)} initialState={await onboardingState(session)} canManageUsers={["COO", "SUPER_ADMIN"].includes(session.role)} /></>;
}
