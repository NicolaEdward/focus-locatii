import { redirect } from "next/navigation";
import { FocusLogo } from "@/components/brand/FocusLogo";
import { LoginForm } from "@/components/admin/LoginForm";
import { getAdminSession } from "@/lib/auth";
import { dashboardPathForRole } from "@/lib/rbac";
import { authEmailCapability } from "@/lib/transactional-email";
import { onboardingLoginTarget } from "@/lib/login-continuation";

export default async function AdminLoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const continuation = onboardingLoginTarget((await searchParams).next);
  const session = await getAdminSession();
  if (session) redirect(continuation || dashboardPathForRole(session.role));

  return (
    <main className="focus-shell grid min-h-screen place-items-center p-4">
      <div className="grid w-full gap-6">
        <div className="mx-auto">
          <FocusLogo />
        </div>
        <LoginForm passwordResetAvailable={authEmailCapability().enabled} returnTo={continuation} />
      </div>
    </main>
  );
}
