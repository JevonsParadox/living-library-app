import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/nebula/admin";

/**
 * Server-side admin gate for /admin/* routes. Non-admins get bounced to /home.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const ok = await isAdmin();
  if (!ok) redirect("/home");
  return (
    <div className="min-h-screen bg-[#05070A] text-foreground">
      <header className="border-b border-white/10 px-6 py-3">
        <h1 className="text-sm font-semibold text-white/80">Admin</h1>
      </header>
      <main className="px-6 py-6">{children}</main>
    </div>
  );
}
