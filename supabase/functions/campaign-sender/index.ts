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
// Códigos de teto de tier de mensageria / qualidade do número — pausar a
// campanha inteira, não marcar destinatários restantes como falha definitiva
// (ver GraphApiError.isMessagingLimitError em apps/web/lib/whatsapp-cloud/graphClient.ts).
const MESSAGING_LIMIT_CODES = new Set([130472, 131048, 131056]);

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
  await supabase.rpc("reclaim_stuck_campaign_recipients", { p_campaign_id: campaignId, p_stuck_minutes: 5 });

  // Claim atômico do lote — SKIP LOCKED garante que esta invocação nunca
  // pega uma linha que outra invocação concorrente já reivindicou.
  const { data: batch, error: claimError } = await supabase.rpc("claim_campaign_recipients", {
    p_campaign_id: campaignId,
    p_batch_size: BATCH_SIZE,
  });

  if (claimError) {
    await logEvent(campaign.tenant_id, "error", { campaignId }, `claim_campaign_recipients: ${claimError.message}`);
    return new Response("Claim failed", { status: 500 });
  }

  const recipients = (batch ?? []) as Recipient[];

  if (recipients.length === 0) {
    // Nada pendente/preso — verificar se a campanha terminou
    await maybeCompleteCampaign(campaign);
    return new Response(JSON.stringify({ processed: 0, done: true }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  }

  let messagingLimitHit = false;

  for (let i = 0; i < recipients.length; i += CONCURRENCY) {
    if (messagingLimitHit) break;
    const slice = recipients.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(slice.map((r) => sendOne(campaign, credential, r)));

    for (let j = 0; j < results.length; j++) {
      const result = results[j];
      if (result.status === "fulfilled" && result.value.messagingLimitHit) {
        messagingLimitHit = true;
      }
    }
  }

  if (messagingLimitHit) {
    // Devolve os destinatários ainda não processados deste lote para pending
    // (não deveria sobrar nenhum 'sending' órfão, mas por segurança) e pausa.
    await supabase
      .from("campaign_recipients")
      .update({ status: "pending" })
      .eq("campaign_id", campaignId)
      .eq("status", "sending");
    await supabase.from("campaigns").update({ status: "paused", updated_at: new Date().toISOString() }).eq("id", campaignId);
    await logEvent(campaign.tenant_id, "campaign_paused", { campaignId, reason: "messaging_limit" });
  }

  await supabase.rpc("recompute_campaign_counters", { p_campaign_id: campaignId });
  await maybeCompleteCampaign(campaign);

  return new Response(JSON.stringify({ processed: recipients.length, messagingLimitHit }), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
});

async function sendOne(
  campaign: Campaign,
  credential: Credential,
  recipient: Recipient,
): Promise<{ messagingLimitHit: boolean }> {
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
        return { messagingLimitHit: true };
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

      return { messagingLimitHit: false };
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

    return { messagingLimitHit: false };
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

    return { messagingLimitHit: false };
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
