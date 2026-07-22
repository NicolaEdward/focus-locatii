import { PasswordActionForm } from "@/components/admin/PasswordActionForm";
import { FocusLogo } from "@/components/brand/FocusLogo";

export default async function AcceptInvitePage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  return <main className="focus-shell grid min-h-screen place-items-center p-4"><div className="grid w-full gap-6"><div className="mx-auto"><FocusLogo /></div><PasswordActionForm token={token} mode="invite" /></div></main>;
}
