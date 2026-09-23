import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import DashboardShell from "@/components/dashboard-shell";

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
    <DashboardShell operatorName={operator.name ?? user.email ?? ""} role={operator.role}>
      {/* overflow-y-auto (não overflow-hidden) no <main> do shell: páginas
          admin comuns (Campanhas, Sessões, etc.) crescem com o conteúdo e
          precisam rolar. O inbox ((inbox)/layout.tsx) usa h-full internamente
          e gerencia seu próprio scroll por coluna, então não aciona a barra ali. */}
      {children}
    </DashboardShell>
  );
}
