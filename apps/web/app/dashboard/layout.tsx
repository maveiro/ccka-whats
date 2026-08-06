import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Sidebar from "@/components/sidebar";
import AlertNotifier from "@/components/alert-notifier";
import { Toaster } from "sonner";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Middleware já garante que user existe ao chegar aqui
  if (!user) redirect("/login");

  const { data: operator } = await supabase
    .from("operators")
    .select("name, role, tenant_id")
    .eq("id", user.id)
    .single();

  // Operator não encontrado = usuário sem perfil cadastrado
  if (!operator) redirect("/login");

  return (
    <div className="flex h-screen bg-gray-950 text-white overflow-hidden">
      <Sidebar operatorName={operator.name ?? user.email ?? ""} role={operator.role} />
      {/* overflow-y-auto (não overflow-hidden): páginas admin comuns (Campanhas,
          Sessões, etc.) crescem com o conteúdo e precisam rolar. O inbox
          ((inbox)/layout.tsx) usa h-full internamente e gerencia seu próprio
          scroll por coluna, então não aciona a barra daqui. */}
      <main className="flex-1 overflow-y-auto">{children}</main>
      <Toaster position="top-right" theme="dark" richColors />
      <AlertNotifier />
    </div>
  );
}
