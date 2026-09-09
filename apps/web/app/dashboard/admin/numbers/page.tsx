import { redirect } from "next/navigation";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import NumbersManager from "./numbers-manager";

// Números WhatsApp Cloud API do tenant — cadastro self-service (Sprint A2 do
// PRD). Antes disso, o cadastro só existia dentro do wizard de campanhas, que
// tratava o número como um só ("trocar credencial"); hoje campanhas e
// automações escolhem entre N números, e este é o lugar de administrá-los.
//
// Admin-only: guarda access_token de disparo, mesmo critério de Campanhas.

export default async function NumbersPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: operator } = await supabase
    .from("operators")
    .select("role, tenant_id")
    .eq("id", user!.id)
    .single();

  if (operator?.role !== "admin") redirect("/dashboard");

  // Tabela deny-all (guarda o token): só o admin client lê, com tenant
  // explícito — exceção documentada à regra 15.
  const admin = createAdminClient();
  const { data: numeros } = await admin
    .from("whatsapp_cloud_credentials")
    .select("id, waba_id, phone_number_id, display_phone_number, label, artista, active, created_at")
    .eq("tenant_id", operator.tenant_id)
    .order("created_at", { ascending: true });

  // Quantas automações ativas cada número tem — desativar um número com Flow
  // ativo é bloqueado, e o operador precisa ver isso antes de tentar.
  const { data: flows } = await admin
    .from("whatsapp_flows")
    .select("cloud_credential_id, ativo")
    .eq("tenant_id", operator.tenant_id)
    .is("deleted_at", null);

  const flowsAtivosPorNumero: Record<string, number> = {};
  for (const f of flows ?? []) {
    if (!f.ativo) continue;
    flowsAtivosPorNumero[f.cloud_credential_id] = (flowsAtivosPorNumero[f.cloud_credential_id] ?? 0) + 1;
  }

  return (
    <div className="p-6 max-w-3xl space-y-8">
      <div>
        <h1 className="text-lg font-semibold text-white">Números — WhatsApp Cloud API</h1>
        <p className="text-sm text-gray-400 mt-1">
          Números oficiais do tenant. Cada um recebe mensagens na caixa de entrada
          compartilhada e pode ter campanhas e uma automação por palavra-chave.
        </p>
      </div>

      <NumbersManager initial={numeros ?? []} flowsAtivosPorNumero={flowsAtivosPorNumero} />
    </div>
  );
}
