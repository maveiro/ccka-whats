import "server-only";
import { createAdminClient } from "@/lib/supabase/server";

export interface CloudCredential {
  id: string;
  waba_id: string;
  phone_number_id: string;
  access_token: string;
}

const CAMPOS = "id, waba_id, phone_number_id, access_token";

/**
 * Único leitor pretendido de whatsapp_cloud_credentials.access_token — RLS
 * é deny-all na tabela, então isso só funciona com o admin client
 * (service-role). Nunca expor o retorno inteiro ao client.
 *
 * ─── Um tenant tem N números (04/09/2026) ───────────────────────────────────
 * Até aqui este módulo assumia no máximo UMA credencial ativa por tenant e
 * resolvia com `.maybeSingle()`. Quando a WABA da Plauz passou a ter os 4
 * números cadastrados, essa query começou a devolver PGRST116 ("The result
 * contains 4 rows") — ou seja, `null` — e os dois consumidores traduziam isso
 * para o usuário como "Nenhuma credencial do WhatsApp Cloud API cadastrada":
 * envio pelo chat e listagem de templates quebraram em produção.
 *
 * A premissa era de código, não de schema (a tabela sempre teve
 * `unique (tenant_id, phone_number_id)`, plural). Preferir sempre uma das
 * resoluções EXATAS abaixo; getCloudCredential(tenantId) fica como último
 * recurso, e nunca mais falha por ambiguidade.
 */

/** Resolução exata por credencial — use quando o id já é conhecido. */
export async function getCloudCredentialById(credentialId: string): Promise<CloudCredential | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("whatsapp_cloud_credentials")
    .select(CAMPOS)
    .eq("id", credentialId)
    .eq("active", true)
    .maybeSingle();

  if (error) {
    console.error("getCloudCredentialById: falha ao consultar whatsapp_cloud_credentials", error);
    return null;
  }
  return data;
}

/**
 * Resolução pela sessão do chat — o caminho certo para responder uma conversa.
 * `wa_sessions.cloud_credential_id` tem índice único (migration 0021), então
 * a sessão identifica o número sem ambiguidade. Isso também corrige um bug
 * silencioso do caminho antigo: responder num chat do número A podia sair pelo
 * número B, porque a credencial era escolhida por tenant, não pela conversa.
 */
export async function getCloudCredentialForSession(sessionId: string): Promise<CloudCredential | null> {
  const admin = createAdminClient();
  const { data: sessao, error: sessaoError } = await admin
    .from("wa_sessions")
    .select("cloud_credential_id")
    .eq("id", sessionId)
    .maybeSingle();

  if (sessaoError) {
    console.error("getCloudCredentialForSession: falha ao consultar wa_sessions", sessaoError);
    return null;
  }
  if (!sessao?.cloud_credential_id) return null;

  return getCloudCredentialById(sessao.cloud_credential_id as string);
}

/**
 * Fallback por tenant: devolve a credencial ativa MAIS ANTIGA.
 * Sem `.maybeSingle()` de propósito — com N números ativos ele falhava inteiro
 * em vez de escolher. Use só onde não há número no contexto (ex.: listar
 * templates da WABA antes de o usuário escolher um número).
 */
export async function getCloudCredential(tenantId: string): Promise<CloudCredential | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("whatsapp_cloud_credentials")
    .select(CAMPOS)
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .order("created_at", { ascending: true })
    .limit(1);

  if (error) {
    console.error("getCloudCredential: falha ao consultar whatsapp_cloud_credentials", error);
    return null;
  }
  return data?.[0] ?? null;
}
