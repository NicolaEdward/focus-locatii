import { redirect } from "next/navigation";
import { FocusLogo } from "@/components/brand/FocusLogo";
import { LoginForm } from "@/components/admin/LoginForm";
import { getAdminSession } from "@/lib/auth";
import { dashboardPathForRole } from "@/lib/rbac";

export default async function AdminLoginPage() {
  const session = await getAdminSession();
  if (session) redirect(dashboardPathForRole(session.role));

  return (
    <main className="focus-shell grid min-h-screen place-items-center p-4">
      <div className="grid w-full gap-6">
        <div className="mx-auto">
          <FocusLogo />
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
