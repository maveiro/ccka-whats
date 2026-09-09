import { redirect } from "next/navigation";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import FlowsManager from "./flows-manager";

// Gestão de Flows (automação por palavra-chave) — Sprint A2 do PRD
// docs/prd/prd-automacao-flows-whatsapp.md.
//
// Admin e operator entram (decisão fechada do PRD); o que cada um pode fazer é
// decidido pela RLS da 0025 — operator só enxerga Flow de número a que tem
// acesso (has_cloud_credential_access), e exclusão é admin-only.

export default async function FlowsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: operator } = await supabase
    .from("operators")
    .select("role, tenant_id")
    .eq("id", user!.id)
    .single();

  if (!operator || !["admin", "operator"].includes(operator.role)) redirect("/dashboard");

  // RLS filtra por tenant e por acesso ao número — sem .eq("tenant_id") aqui
  // (regra 15 do CLAUDE.md).
  const { data: flows } = await supabase
    .from("whatsapp_flows")
    .select("id, cloud_credential_id, artista, nome, tipo, ativo, meta_flow_id, mensagem_boas_vindas, mensagem_fallback, created_at, flow_palavras_chave!flow_palavras_chave_flow_id_fkey(id, palavra_chave, tipo_resposta, resposta, flow_destino_id, deleted_at)")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  // whatsapp_cloud_credentials é deny-all (guarda o access_token): só o admin
  // client lê, com filtro de tenant explícito — mesma exceção documentada da
  // página de campanhas.
  const admin = createAdminClient();
  const { data: credenciais } = await admin
    .from("whatsapp_cloud_credentials")
    .select("id, phone_number_id, display_phone_number, label, artista")
    .eq("tenant_id", operator.tenant_id)
    .eq("active", true)
    .order("created_at", { ascending: true });

  const flowsLimpos = (flows ?? []).map((f) => ({
    ...f,
    flow_palavras_chave: (f.flow_palavras_chave ?? []).filter(
      (k: { deleted_at: string | null }) => k.deleted_at === null,
    ),
  }));

  return (
    <div className="p-6 max-w-3xl space-y-8">
      <div>
        <h1 className="text-lg font-semibold text-white">Automações por palavra-chave</h1>
        <p className="text-sm text-gray-400 mt-1">
          Resposta automática por regra fixa: a mensagem recebida é comparada com as
          palavras-chave do número e responde o texto ou link cadastrado. Sem IA
          gerando texto — o que não bate cai na mensagem de fallback.
        </p>
      </div>

      <FlowsManager
        initial={flowsLimpos}
        destinos={flowsLimpos
          .filter((f) => f.meta_flow_id && f.ativo)
          .map((f) => ({ id: f.id, nome: f.nome, tipo: f.tipo, cloud_credential_id: f.cloud_credential_id }))}
        credenciais={credenciais ?? []}
        isAdmin={operator.role === "admin"}
      />
    </div>
  );
}
