import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import IntegrationsManager from "./integrations-manager";

export default async function IntegrationsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: operator } = await supabase
    .from("operators")
    .select("role, tenant_id")
    .eq("id", user!.id)
    .single();

  if (operator?.role !== "admin") redirect("/dashboard");

  const { data: integrations } = await supabase
    .from("integrations")
    .select("id, type, label, config, active, created_at")
    .eq("tenant_id", operator.tenant_id)
    .order("created_at", { ascending: true });

  return (
    <div className="p-6 max-w-2xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-white">Integrações & API Keys</h1>
        <p className="text-sm text-gray-400 mt-1">
          Conecte serviços externos e gerencie chaves de API.
        </p>
      </div>

      <IntegrationsManager
        integrations={integrations ?? []}
        tenantId={operator.tenant_id}
      />
    </div>
  );
}
