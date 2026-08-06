// Webhook de status de entrega do WhatsApp Cloud API (oficial) — separado
// de whatsapp-webhook (Evolution/Baileys), zero código em comum além de
// events_log. GET responde o handshake de assinatura do Meta; POST recebe
// eventos de status (sent/delivered/read/failed) por wamid.
// verify_jwt=false — chamada pelo Meta, sem Authorization Supabase.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const META_APP_SECRET = Deno.env.get("META_APP_SECRET")!;
const META_WEBHOOK_VERIFY_TOKEN = Deno.env.get("META_WEBHOOK_VERIFY_TOKEN")!;

// Guarda de precedência: nunca sobrescrever um status "mais avançado" com um
// evento atrasado que chegue fora de ordem (o Meta não garante ordem de
// entrega dos eventos de status).
const STATUS_RANK: Record<string, number> = {
  sent: 1,
  delivered: 2,
  read: 3,
  failed: 1, // terminal, mas não "mais avançado" que delivered/read
};

interface CloudWebhookPayload {
  entry?: {
    id: string;
    changes?: {
      field: string;
      value: {
        metadata?: { phone_number_id?: string };
        statuses?: {
          id: string; // wamid
          status: string; // sent|delivered|read|failed
          timestamp: string;
          errors?: { code: number; title: string }[];
        }[];
      };
    }[];
  }[];
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);

  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (mode === "subscribe" && token === META_WEBHOOK_VERIFY_TOKEN && challenge) {
      return new Response(challenge, { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const rawBody = await req.text();
  const signature = req.headers.get("X-Hub-Signature-256") ?? "";

  if (!(await verifySignature(rawBody, signature))) {
    await logEvent(null, "error", null, "Invalid X-Hub-Signature-256");
    return new Response("Unauthorized", { status: 401 });
  }

  let body: CloudWebhookPayload;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  // Responder 200 imediatamente — processamento é best-effort, mesmo padrão
  // do whatsapp-webhook (Evolution).
  const responsePromise = processEvent(body);
  responsePromise.catch((err) => {
    console.error("Unhandled cloud webhook error:", err);
  });

  return new Response("ok", { status: 200 });
});

async function verifySignature(rawBody: string, signatureHeader: string): Promise<boolean> {
  if (!signatureHeader.startsWith("sha256=")) return false;
  const expectedHex = signatureHeader.slice(7);

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(META_APP_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signatureBytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const computedHex = Array.from(new Uint8Array(signatureBytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  if (computedHex.length !== expectedHex.length) return false;
  let diff = 0;
  for (let i = 0; i < computedHex.length; i++) diff |= computedHex.charCodeAt(i) ^ expectedHex.charCodeAt(i);
  return diff === 0;
}

async function processEvent(body: CloudWebhookPayload): Promise<void> {
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "messages") continue;

      for (const status of change.value.statuses ?? []) {
        await handleStatus(status);
      }
    }
  }
}

async function handleStatus(status: {
  id: string;
  status: string;
  timestamp: string;
  errors?: { code: number; title: string }[];
}): Promise<void> {
  const { data: recipient, error: findError } = await supabase
    .from("campaign_recipients")
    .select("id, tenant_id, campaign_id, status")
    .eq("wamid", status.id)
    .maybeSingle();

  if (findError) {
    await logEvent(null, "error", { wamid: status.id }, `campaign_recipients lookup: ${findError.message}`);
    return;
  }

  if (!recipient) {
    // wamid não corresponde a nenhuma campanha conhecida — pode ser evento
    // duplicado após a campanha ser limpa, ou mensagem fora deste módulo.
    return;
  }

  const newStatus = status.status; // sent|delivered|read|failed
  const currentRank = STATUS_RANK[recipient.status] ?? 0;
  const newRank = STATUS_RANK[newStatus] ?? 0;

  // Guarda de precedência: só aplica se for um avanço real, exceto 'failed'
  // que sempre é registrado (mas não regride um status já avançado).
  if (newStatus !== "failed" && newRank <= currentRank) {
    await logEvent(recipient.tenant_id, "campaign_status_event", {
      campaignId: recipient.campaign_id,
      recipientId: recipient.id,
      wamid: status.id,
      status: newStatus,
      ignored: true,
      reason: "stale_or_duplicate",
    });
    return;
  }
  if (newStatus === "failed" && currentRank >= STATUS_RANK.delivered) {
    // Já foi entregue/lido — um "failed" atrasado não regride isso.
    await logEvent(recipient.tenant_id, "campaign_status_event", {
      campaignId: recipient.campaign_id,
      recipientId: recipient.id,
      wamid: status.id,
      status: newStatus,
      ignored: true,
      reason: "already_delivered",
    });
    return;
  }

  const timestampIso = new Date(Number(status.timestamp) * 1000).toISOString();
  const update: Record<string, unknown> = { status: newStatus };
  if (newStatus === "delivered") update.delivered_at = timestampIso;
  if (newStatus === "read") update.read_at = timestampIso;
  if (newStatus === "failed") {
    update.failed_at = timestampIso;
    update.error = status.errors?.[0]?.title ?? "delivery failed";
  }

  const { error: updateError } = await supabase.from("campaign_recipients").update(update).eq("id", recipient.id);
  if (updateError) {
    await logEvent(recipient.tenant_id, "error", { recipientId: recipient.id }, `campaign_recipients update: ${updateError.message}`);
    return;
  }

  await supabase.rpc("recompute_campaign_counters", { p_campaign_id: recipient.campaign_id });

  await logEvent(recipient.tenant_id, "campaign_status_event", {
    campaignId: recipient.campaign_id,
    recipientId: recipient.id,
    wamid: status.id,
    status: newStatus,
  });
}

async function logEvent(
  tenantId: string | null,
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
