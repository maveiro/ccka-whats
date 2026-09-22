import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import type { TemplateFormInput } from "./templateComponents";

/**
 * Resolve um botão de Flow do formulário (que carrega o UUID da NOSSA
 * `whatsapp_flows`) para o que a Meta espera (`meta_flow_id` + tela de
 * entrada) — validando no caminho. Compartilhado entre criar e editar
 * template: as duas rotas montam `components` do mesmo jeito.
 *
 * Mesma checagem de `POST /api/campaigns` (regra 37): mesmo tenant, mesmo
 * número, ativo, publicado, tipo abrível numa conversa.
 */
export async function resolverBotaoFlow(
  tenantId: string,
  credentialId: string,
  botao: TemplateFormInput["botao"],
): Promise<{ ok: true; botao: TemplateFormInput["botao"] } | { ok: false; erro: string }> {
  if (botao?.modo !== "flow") return { ok: true, botao };

  if (!botao.flowId) return { ok: false, erro: "Escolha qual Flow o botão abre" };

  const admin = createAdminClient();
  const { data: flow } = await admin
    .from("whatsapp_flows")
    .select("id, tipo, ativo, meta_flow_id, cloud_credential_id, tenant_id, tela_inicial")
    .eq("id", botao.flowId)
    .is("deleted_at", null)
    .maybeSingle();

  if (!flow || flow.tenant_id !== tenantId) return { ok: false, erro: "Flow não encontrado" };
  if (flow.cloud_credential_id !== credentialId) {
    return { ok: false, erro: "O Flow escolhido é de outro número — abriria a central errada" };
  }
  if (!flow.ativo || !flow.meta_flow_id) {
    return { ok: false, erro: "O Flow escolhido não está ativo e publicado na Meta" };
  }
  if (!["central", "agenda_shows"].includes(flow.tipo)) {
    return { ok: false, erro: "Esse Flow não é do tipo que se abre numa conversa" };
  }

  // Mesma tela que o flow-engine abriria no INIT — tela_inicial quando
  // setada, senão o padrão do tipo.
  const navigateScreen = flow.tela_inicial ?? (flow.tipo === "central" ? "APRESENTACAO" : "AGENDA");
  return { ok: true, botao: { ...botao, flowId: flow.meta_flow_id, navigateScreen } };
}
