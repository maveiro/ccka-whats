// Envia um lote de campaign_recipients pendentes via WhatsApp Cloud API.
// Chamada por POST /api/campaigns/[id]/fire (primeiro tick) e reinvocada
// periodicamente por pg_cron para qualquer campanha 'sending' com pending
// restante (ver 0020_campaign_sender_cron.sql). Segura contra invocações
// sobrepostas: claim_campaign_recipients() usa FOR UPDATE SKIP LOCKED, então
// duas invocações concorrentes nunca processam a mesma linha (zero
// double-send). verify_jwt=true — só chamada internamente com service role.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const GRAPH_API_VERSION = "v23.0";
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;
const FETCH_TIMEOUT_MS = 20_000;
const BATCH_SIZE = 50;
const CONCURRENCY = 5;
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 1_000;
// Teto de LOTES por invocação — NÃO maximizar até o limite técnico da Edge
// Function (150s). Achado em produção (07/08/2026): uma campanha real de
// 5.043 destinatários enviada a ~500/min (multi-lote sem teto, dentro do
// orçamento de tempo antigo) teve 21% de falha por "Spam Rate limit hit" —
// a Meta tem proteção de "healthy ecosystem engagement" que penaliza rajada
// de volume, independente do teto técnico de mps documentado (80-1000/s).
// Uma campanha do dia anterior a ~200-270/min teve só ~5% de falha, sem essa
// causa específica. Vazão alvo agora: no máximo MAX_BATCHES_PER_INVOCATION
// lotes de BATCH_SIZE por tick do cron (1x/min) — prioriza taxa de entrega
// e reputação do número sobre velocidade bruta. Subir isso de novo exige
// evidência de que não aumenta esse tipo de falha, não só "está dentro do
// limite técnico".
const MAX_BATCHES_PER_INVOCATION = 2;
// Códigos de teto de tier de mensageria / qualidade do número — pausar a
// campanha inteira, não marcar destinatários restantes como falha definitiva
// (ver GraphApiError.isMessagingLimitError em apps/web/lib/whatsapp-cloud/graphClient.ts).
const MESSAGING_LIMIT_CODES = new Set([130472, 131048, 131056]);
// Throughput por segundo excedido (padrão Cloud API: 80 mps/número, até
// 1000 mps por upgrade) — erro transitório, não de destinatário nem de tier
// diário. Não conta tentativa, não pausa a campanha: só devolve pra pending
// e para de reivindicar lotes novos nesta invocação — o próximo tick do
// cron (até 60s depois) já é backoff suficiente pra esse tipo de erro.
const THROUGHPUT_LIMIT_CODE = 130429;

interface SendRequest {
  campaignId: string;
}

interface Recipient {
  id: string;
  tenant_id: string;
  campaign_id: string;
  phone_e164: string;
  variables: Record<string, unknown>;
  attempts: number;
}

interface Campaign {
  id: string;
  tenant_id: string;
  status: string;
  template_name: string;
  template_language: string;
  template_components: unknown[] | null;
  credential_id: string;
}

interface Credential {
  phone_number_id: string;
  access_token: string;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  let body: SendRequest;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const { campaignId } = body;
  if (!campaignId) return new Response("campaignId is required", { status: 400 });

  const { data: campaign, error: campaignError } = await supabase
    .from("campaigns")
    .select("id, tenant_id, status, template_name, template_language, template_components, credential_id")
    .eq("id", campaignId)
    .single<Campaign>();

  if (campaignError || !campaign) {
    return new Response("Campaign not found", { status: 404 });
  }

  if (campaign.status !== "sending") {
    // Não é erro — pg_cron pode reinvocar depois que a campanha já terminou
    // ou foi pausada por outra invocação. Idempotente: apenas encerra.
    return new Response(JSON.stringify({ skipped: true, status: campaign.status }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  }

  const { data: credential, error: credError } = await supabase
    .from("whatsapp_cloud_credentials")
    .select("phone_number_id, access_token")
    .eq("id", campaign.credential_id)
    .single<Credential>();

  if (credError || !credential) {
    await failCampaign(campaign, "Credencial do Cloud API não encontrada ou inativa");
    return new Response("Credential not found", { status: 500 });
  }

  // Reclaim de destinatários presos em 'sending' há >5min (crash em ciclo anterior)
  // — uma vez por invocação, não por lote.
  await supabase.rpc("reclaim_stuck_campaign_recipients", { p_campaign_id: campaignId, p_stuck_minutes: 5 });

  let totalProcessed = 0;
  let messagingLimitHit = false;
  let throughputLimitHit = false;

  for (let batchNum = 0; batchNum < MAX_BATCHES_PER_INVOCATION; batchNum++) {
    // Claim atômico do lote — SKIP LOCKED garante que esta invocação nunca
    // pega uma linha que outra invocação concorrente (próximo tick do cron
    // sobrepondo esta, se ela passar de 1min) já reivindicou.
    const { data: batch, error: claimError } = await supabase.rpc("claim_campaign_recipients", {
      p_campaign_id: campaignId,
      p_batch_size: BATCH_SIZE,
    });

    if (claimError) {
      await logEvent(campaign.tenant_id, "error", { campaignId }, `claim_campaign_recipients: ${claimError.message}`);
      break;
    }

    const recipients = (batch ?? []) as Recipient[];
    if (recipients.length === 0) break; // nada pendente/preso neste momento

    for (let i = 0; i < recipients.length; i += CONCURRENCY) {
      if (messagingLimitHit || throughputLimitHit) break;
      const slice = recipients.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(slice.map((r) => sendOne(campaign, credential, r)));

      for (const result of results) {
        if (result.status !== "fulfilled") continue;
        if (result.value.messagingLimitHit) messagingLimitHit = true;
        if (result.value.throughputLimitHit) throughputLimitHit = true;
      }
    }

    totalProcessed += recipients.length;
    if (messagingLimitHit || throughputLimitHit) break;
  }

  if (messagingLimitHit) {
    // Devolve os destinatários ainda não processados deste lote para pending
    // (não deveria sobrar nenhum 'sending' órfão, mas por segurança) e pausa
    // a campanha inteira — teto de 24h só se resolve manualmente/no dia seguinte.
    await supabase
      .from("campaign_recipients")
      .update({ status: "pending" })
      .eq("campaign_id", campaignId)
      .eq("status", "sending");
    await supabase.from("campaigns").update({ status: "paused", updated_at: new Date().toISOString() }).eq("id", campaignId);
    await logEvent(campaign.tenant_id, "campaign_paused", { campaignId, reason: "messaging_limit" });
  } else if (throughputLimitHit) {
    // Erro transitório de mensagens/segundo — NÃO pausa a campanha, só para
    // de reivindicar lotes novos nesta invocação. Recipient já voltou pra
    // pending em sendOne(); o próximo tick do cron (≤60s) já é backoff.
    await logEvent(campaign.tenant_id, "campaign_throughput_backoff", { campaignId, totalProcessed });
  }

  await supabase.rpc("recompute_campaign_counters", { p_campaign_id: campaignId });
  await maybeCompleteCampaign(campaign);

  return new Response(JSON.stringify({ processed: totalProcessed, messagingLimitHit, throughputLimitHit }), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
});

async function sendOne(
  campaign: Campaign,
  credential: Credential,
  recipient: Recipient,
): Promise<{ messagingLimitHit: boolean; throughputLimitHit: boolean }> {
  try {
    const response = await fetchWithRetry(`${GRAPH_API_BASE}/${credential.phone_number_id}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${credential.access_token}`,
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: recipient.phone_e164,
        type: "template",
        template: {
          name: campaign.template_name,
          language: { code: campaign.template_language },
          ...(buildComponents(recipient.variables) ? { components: buildComponents(recipient.variables) } : {}),
        },
      }),
    });

    const json = await response.json().catch(() => ({} as Record<string, unknown>));

    if (!response.ok) {
      const errorBody = (json as Record<string, unknown>).error as
        | { message?: string; code?: number }
        | undefined;

      // Log de tentativa (sucesso OU rejeição) — é isso que fecha "logar todo o movimento"
      await logEvent(campaign.tenant_id, "campaign_send_attempt", {
        campaignId: campaign.id,
        recipientId: recipient.id,
        phone: recipient.phone_e164,
        ok: false,
        status: response.status,
      }, errorBody?.message ?? `HTTP ${response.status}`);

      if (errorBody?.code && MESSAGING_LIMIT_CODES.has(errorBody.code)) {
        await supabase.from("campaign_recipients").update({ status: "pending" }).eq("id", recipient.id);
        return { messagingLimitHit: true, throughputLimitHit: false };
      }

      if (errorBody?.code === THROUGHPUT_LIMIT_CODE) {
        // Não conta tentativa — não é um problema com este destinatário.
        await supabase.from("campaign_recipients").update({ status: "pending" }).eq("id", recipient.id);
        return { messagingLimitHit: false, throughputLimitHit: true };
      }

      // Erro definitivo (template/parâmetro inválido, número inválido, etc.)
      await supabase
        .from("campaign_recipients")
        .update({
          status: recipient.attempts + 1 >= 3 ? "failed" : "pending",
          attempts: recipient.attempts + 1,
          error: errorBody?.message ?? `HTTP ${response.status}`,
          failed_at: recipient.attempts + 1 >= 3 ? new Date().toISOString() : null,
        })
        .eq("id", recipient.id);

      return { messagingLimitHit: false, throughputLimitHit: false };
    }

    const wamid = (json as { messages?: { id: string }[] }).messages?.[0]?.id;

    await supabase
      .from("campaign_recipients")
      .update({
        status: "sent",
        wamid: wamid ?? null,
        sent_at: new Date().toISOString(),
        error: null,
      })
      .eq("id", recipient.id);

    await logEvent(campaign.tenant_id, "campaign_send_attempt", {
      campaignId: campaign.id,
      recipientId: recipient.id,
      phone: recipient.phone_e164,
      ok: true,
      wamid,
    });

    return { messagingLimitHit: false, throughputLimitHit: false };
  } catch (err) {
    await supabase
      .from("campaign_recipients")
      .update({
        status: recipient.attempts + 1 >= 3 ? "failed" : "pending",
        attempts: recipient.attempts + 1,
        error: String(err),
        failed_at: recipient.attempts + 1 >= 3 ? new Date().toISOString() : null,
      })
      .eq("id", recipient.id);

    await logEvent(campaign.tenant_id, "campaign_send_attempt", {
      campaignId: campaign.id,
      recipientId: recipient.id,
      phone: recipient.phone_e164,
      ok: false,
    }, String(err));

    return { messagingLimitHit: false, throughputLimitHit: false };
  }
}

/**
 * Monta os parâmetros de corpo do template a partir de recipient.variables
 * (chaves "1", "2", ... correspondendo aos placeholders {{1}}, {{2}}, ... do
 * template, na ordem numérica) — cada destinatário recebe o texto que veio
 * da própria linha do CSV, não um valor estático da campanha.
 * campaign.template_components (jsonb salvo na criação) é só metadata usada
 * pela UI para saber quantos placeholders o template tem — nunca é enviado
 * como está para a Graph API.
 */
function buildComponents(variables: Record<string, unknown>): unknown[] | undefined {
  const keys = Object.keys(variables ?? {}).sort((a, b) => Number(a) - Number(b));
  if (keys.length === 0) return undefined;
  return [{
    type: "body",
    parameters: keys.map((k) => ({ type: "text", text: String(variables[k]) })),
  }];
}

async function maybeCompleteCampaign(campaign: Campaign): Promise<void> {
  const { count: pendingCount } = await supabase
    .from("campaign_recipients")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaign.id)
    .in("status", ["pending", "sending"]);

  if ((pendingCount ?? 0) === 0) {
    // Reler status atual — pode já ter sido pausado por messagingLimitHit nesta mesma invocação
    const { data: current } = await supabase.from("campaigns").select("status").eq("id", campaign.id).single();
    if (current?.status === "sending") {
      await supabase.from("campaigns").update({ status: "completed", updated_at: new Date().toISOString() }).eq("id", campaign.id);
      await logEvent(campaign.tenant_id, "campaign_completed", { campaignId: campaign.id });
    }
  }
}

async function failCampaign(campaign: Campaign, reason: string): Promise<void> {
  await supabase.from("campaigns").update({ status: "failed", updated_at: new Date().toISOString() }).eq("id", campaign.id);
  await logEvent(campaign.tenant_id, "error", { campaignId: campaign.id }, reason);
}

async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    } catch (err) {
      if (attempt === MAX_RETRIES) throw err;
      await sleep(BASE_BACKOFF_MS * 2 ** attempt + Math.random() * 250);
      continue;
    }
    if ((response.status === 429 || response.status >= 500) && attempt < MAX_RETRIES) {
      const retryAfter = response.headers.get("Retry-After");
      await sleep(retryAfter ? Number(retryAfter) * 1000 : BASE_BACKOFF_MS * 2 ** attempt + Math.random() * 250);
      continue;
    }
    return response;
  }
  throw new Error("unreachable");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function logEvent(
  tenantId: string,
  eventType: string,
  payload: unknown,
  error?: string,
): Promise<void> {
  await supabase.from("events_log").insert({
    tenant_id: tenantId,
    session_id: null,
    event_type: eventType,
    payload,
    error: error ?? null,
  });
}
