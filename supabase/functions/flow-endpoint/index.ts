// Endpoint de dados do WhatsApp Flow — Sprint B1 (spike de criptografia).
// PRD: docs/prd/prd-automacao-flows-whatsapp.md
//
// ESCOPO DESTE SPIKE: provar a troca criptografada com a Meta (health check +
// erro do cliente), nada além. O Flow `agenda_shows` — ler agenda_shows_sync e
// montar as telas — é a Sprint B2, e o critério de saída do B1 é validar ESTE
// endpoint no Playground oficial antes de comprometer prazo com o resto.
//
// verify_jwt=false: quem chama é a Meta, sem Authorization do Supabase. Ao
// contrário do whatsapp-cloud-webhook, aqui NÃO há assinatura HMAC para
// conferir — a autenticidade vem da própria criptografia: só quem tem a chave
// AES cifrada com a nossa pública consegue produzir um corpo que abre.
//
// A chave privada vive em `internal_secrets` (RLS deny-all, lida só com service
// role) — nunca em env var nem em integrations.config. Decisão explícita do
// PRD: é chave privada, não API key, e repetir aqui a dívida do BYOK seria
// pior. Mesmo desenho do segredo do pg_cron (migration 0023).
//
// Uma chave por número: o Flow aponta para este endpoint com
// ?phone_number_id=..., e cada número tem seu par. A Meta recomenda um par por
// WABA; por número é mais granular e não custa nada a mais.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  abrirRequisicao,
  fecharResposta,
  importarChavePrivada,
  type RequisicaoCriptografada,
} from "./crypto.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const PREFIXO_SEGREDO = "flow_private_key:";

// Cache por invocação (o worker é reaproveitado entre requisições): importar a
// chave a cada chamada custa CPU num endpoint que a Meta espera responder
// rápido — o teto documentado é bem menor que o de uma Edge Function comum.
const cacheChaves = new Map<string, CryptoKey>();

async function obterChavePrivada(phoneNumberId: string): Promise<CryptoKey | null> {
  const cacheada = cacheChaves.get(phoneNumberId);
  if (cacheada) return cacheada;

  const { data, error } = await supabase
    .from("internal_secrets")
    .select("value")
    .eq("key", `${PREFIXO_SEGREDO}${phoneNumberId}`)
    .maybeSingle<{ value: string }>();

  if (error) {
    console.error("[flow-endpoint] falha ao ler internal_secrets:", error.message);
    return null;
  }
  if (!data?.value) return null;

  try {
    const chave = await importarChavePrivada(data.value);
    cacheChaves.set(phoneNumberId, chave);
    return chave;
  } catch (err) {
    console.error("[flow-endpoint] chave privada inválida:", err instanceof Error ? err.message : err);
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  // O número pode vir de dois jeitos, porque a URI do Flow é digitada no
  // painel da Meta e é fácil perder a query string ao copiar/colar:
  //   .../flow-endpoint?phone_number_id=123   (forma preferida)
  //   .../flow-endpoint/123                   (caminho, à prova de cópia)
  const url = new URL(req.url);
  const doCaminho = url.pathname.split("/").filter(Boolean).pop();
  const phoneNumberId = url.searchParams.get("phone_number_id") ??
    (doCaminho && doCaminho !== "flow-endpoint" && /^\d+$/.test(doCaminho) ? doCaminho : null);

  if (!phoneNumberId) {
    console.error("[flow-endpoint] requisição sem phone_number_id (nem na query, nem no caminho)");
    return new Response("Bad Request", { status: 400 });
  }

  let corpoBruto: RequisicaoCriptografada;
  try {
    corpoBruto = await req.json() as RequisicaoCriptografada;
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  if (!corpoBruto.encrypted_flow_data || !corpoBruto.encrypted_aes_key || !corpoBruto.initial_vector) {
    // Campo faltando é payload malformado, não falha de decriptação: 421 aqui
    // faria a Meta rotacionar chave à toa.
    return new Response("Bad Request", { status: 400 });
  }

  const chavePrivada = await obterChavePrivada(phoneNumberId);
  if (!chavePrivada) {
    // Sem chave configurada não há como abrir a requisição — do ponto de vista
    // da Meta é o mesmo caso de falha de decriptação.
    await registrar(phoneNumberId, "flow_endpoint_sem_chave", { phoneNumberId });
    return new Response("Failed to decrypt", { status: 421 });
  }

  let aberta;
  try {
    aberta = await abrirRequisicao(corpoBruto, chavePrivada);
  } catch (err) {
    // 421 é o contrato: diz à Meta que a chave não serve, e o cliente reabre o
    // Flow buscando a chave pública atual em vez de ficar num erro opaco.
    console.error("[flow-endpoint] decriptação falhou:", err instanceof Error ? err.message : err);
    await registrar(phoneNumberId, "flow_endpoint_decrypt_falhou", { phoneNumberId });
    return new Response("Failed to decrypt", { status: 421 });
  }

  const { corpo, chaveAes, iv } = aberta;
  const acao = typeof corpo.action === "string" ? corpo.action : "";

  const resposta = await decidirResposta(acao, corpo, phoneNumberId);

  try {
    const cifrada = await fecharResposta(resposta, chaveAes, iv);
    return new Response(cifrada, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  } catch (err) {
    console.error("[flow-endpoint] falha ao cifrar resposta:", err instanceof Error ? err.message : err);
    return new Response("Internal error", { status: 500 });
  }
});

async function decidirResposta(
  acao: string,
  corpo: Record<string, unknown>,
  phoneNumberId: string,
): Promise<unknown> {
  // Health check periódico da Meta em Flows publicados. Responder isso é
  // requisito de operação, não cortesia: endpoint que não responde ao ping é
  // marcado como indisponível.
  if (acao === "ping") {
    return { data: { status: "active" } };
  }

  // Erro relatado pelo CLIENTE (ex: public-key-missing,
  // public-key-signature-verification). Precisa ser reconhecido e, mais
  // importante, ficar visível: é o sinal de que a chave pública precisa ser
  // reenviada à Meta.
  const dados = (corpo.data ?? {}) as Record<string, unknown>;
  if (dados.error) {
    await registrar(phoneNumberId, "flow_endpoint_erro_do_cliente", {
      phoneNumberId,
      error: dados.error,
      errorMessage: dados.error_message ?? null,
      flowToken: corpo.flow_token ?? null,
    });
    return { data: { acknowledged: true } };
  }

  // INIT / data_exchange / BACK: as telas do Flow `agenda_shows` são a Sprint
  // B2. Reconhecer sem fingir tela evita um Flow que "funciona" mostrando
  // conteúdo vazio — e deixa registrado que a ação chegou.
  await registrar(phoneNumberId, "flow_endpoint_acao_nao_implementada", {
    phoneNumberId,
    acao,
    screen: corpo.screen ?? null,
  });
  return { data: { acknowledged: true } };
}

async function registrar(
  phoneNumberId: string,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  // tenant_id derivado do número (nunca de campo do corpo, que vem de fora).
  const { data: credencial } = await supabase
    .from("whatsapp_cloud_credentials")
    .select("tenant_id")
    .eq("phone_number_id", phoneNumberId)
    .eq("active", true)
    .maybeSingle<{ tenant_id: string }>();

  const { error } = await supabase.from("events_log").insert({
    tenant_id: credencial?.tenant_id ?? null,
    session_id: null,
    event_type: eventType,
    payload,
  });

  if (error) console.error("[flow-endpoint] events_log insert falhou:", error.message);
}
