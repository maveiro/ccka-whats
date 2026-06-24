import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Sidebar from "@/components/sidebar";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: operator } = await supabase
    .from("operators")
    .select("name, role, tenant_id")
    .eq("id", user.id)
    .single();

  if (!operator) redirect("/login");

  return (
    <div className="flex h-screen bg-gray-950 text-white overflow-hidden">
      <Sidebar operatorName={operator.name ?? user.email ?? ""} role={operator.role} />
      <main className="flex-1 overflow-hidden">{children}</main>
    </div>
  );
}
