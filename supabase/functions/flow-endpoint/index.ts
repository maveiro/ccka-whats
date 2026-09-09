// Endpoint de dados do WhatsApp Flow — Trilha B.
// PRD: docs/prd/prd-automacao-flows-whatsapp.md
//
// B1 (concluída, validada no painel da Meta em 09/09/2026): troca
// criptografada, health check e erro do cliente.
// B2 (aqui): telas do Flow `agenda_shows`, servidas a partir de
// agenda_shows_sync — ver ./agenda.ts e o JSON de referência em
// docs/flows/agenda_shows.flow.json.
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
import { type ShowRow, telaAgenda, telaDetalhe } from "./agenda.ts";

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

  // ── Telas do Flow agenda_shows (Sprint B2) ──
  if (acao === "INIT" || acao === "data_exchange") {
    return await responderAgenda(acao, corpo, phoneNumberId);
  }

  // BACK e qualquer ação futura: reconhece sem inventar tela.
  await registrar(phoneNumberId, "flow_endpoint_acao_nao_implementada", {
    phoneNumberId,
    acao,
    screen: corpo.screen ?? null,
  });
  return { data: { acknowledged: true } };
}

/**
 * Monta a tela pedida a partir de agenda_shows_sync.
 *
 * O artista sai da CREDENCIAL do número (whatsapp_cloud_credentials.artista),
 * não de campo do corpo: o payload do Flow vem do cliente e não é fonte
 * confiável para escolher que dados servir. Número sem artista definido serve a
 * agenda inteira do tenant — comportamento consciente, e o aviso está na tela
 * de Números.
 */
async function responderAgenda(
  acao: string,
  corpo: Record<string, unknown>,
  phoneNumberId: string,
): Promise<unknown> {
  const { data: credencial } = await supabase
    .from("whatsapp_cloud_credentials")
    .select("tenant_id, artista")
    .eq("phone_number_id", phoneNumberId)
    .eq("active", true)
    .maybeSingle<{ tenant_id: string; artista: string | null }>();

  if (!credencial) {
    await registrar(phoneNumberId, "flow_endpoint_sem_credencial", { phoneNumberId, acao });
    return telaAgenda([], null);
  }

  const dados = (corpo.data ?? {}) as Record<string, unknown>;

  // Detalhe de um show escolhido na lista.
  const escolhido = typeof dados.show_id === "string" ? dados.show_id : null;
  if (acao === "data_exchange" && escolhido) {
    const { data: show } = await supabase
      .from("agenda_shows_sync")
      .select("id, artista, cidade, teatro, data_show, status_venda, link_compra")
      .eq("tenant_id", credencial.tenant_id)
      .eq("id", escolhido)
      .maybeSingle<ShowRow>();

    // Show removido entre a listagem e o clique: volta para a lista em vez de
    // tela de erro.
    if (show) {
      await registrarTela(phoneNumberId, acao, "DETALHE", { showId: show.id });
      return telaDetalhe(show);
    }
  }

  // Lista: só o que ainda não aconteceu, em ordem cronológica. Show sem data
  // entra no fim (a query ordena com nulls por último).
  let query = supabase
    .from("agenda_shows_sync")
    .select("id, artista, cidade, teatro, data_show, status_venda, link_compra")
    .eq("tenant_id", credencial.tenant_id)
    .or(`data_show.gte.${new Date().toISOString()},data_show.is.null`)
    .order("data_show", { ascending: true, nullsFirst: false })
    .limit(20);

  if (credencial.artista) query = query.eq("artista", credencial.artista);

  const { data: shows, error } = await query;

  if (error) {
    console.error("[flow-endpoint] falha ao ler agenda:", error.message);
    await registrar(phoneNumberId, "flow_endpoint_erro_agenda", { phoneNumberId, erro: error.message });
    // Tela vazia com texto explicativo é melhor que erro cru para quem está do
    // outro lado — e o evento acima é o que sinaliza o problema para nós.
    return telaAgenda([], credencial.artista);
  }

  const resposta = telaAgenda((shows ?? []) as ShowRow[], credencial.artista);
  await registrarTela(phoneNumberId, acao, "AGENDA", { shows: (shows ?? []).length });
  return resposta;
}

/**
 * Registra cada tela servida. Sem isto, uma interação bem-sucedida não deixava
 * rastro nenhum — e na primeira vez que foi preciso responder "o clique chegou
 * até nós?", a resposta honesta foi "não dá para saber" (09/09/2026).
 *
 * É um insert por interação, e isso custa latência num endpoint com teto: fica
 * dentro do orçamento (~1,3s de pior caso contra ~10s da Meta) e é aguardado
 * de propósito — promessa solta pode ser morta quando a resposta retorna, que
 * é o mesmo que não logar.
 */
async function registrarTela(
  phoneNumberId: string,
  acao: string,
  tela: string,
  extra: Record<string, unknown>,
): Promise<void> {
  await registrar(phoneNumberId, "flow_endpoint_tela", { phoneNumberId, acao, tela, ...extra });
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
