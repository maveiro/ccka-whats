import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const PLATFORM_OPENAI_KEY = Deno.env.get("OPENAI_API_KEY");

// Tipos de mensagem que não devem gerar embeddings
const SKIP_TYPES = new Set(["system", "reaction"]);

interface EmbeddingRequest {
  messageId: string;
  body: string;
  tenantId: string;
  messageType?: string;
}

// Resolve a chave OpenAI do tenant: override BYOK (integrations) → chave da
// plataforma (env). Mesmo modelo do helper web apps/web/lib/ai.ts.
async function resolveTenantKey(tenantId: string): Promise<string | null> {
  const { data: integration } = await supabase
    .from("integrations")
    .select("config")
    .eq("tenant_id", tenantId)
    .eq("type", "openai")
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const config = (integration?.config ?? null) as Record<string, unknown> | null;
  const byok = config && typeof config.api_key === "string" ? config.api_key : null;
  if (byok && byok.length > 0) return byok;

  return PLATFORM_OPENAI_KEY ?? null;
}

async function generateEmbedding(text: string, apiKey: string): Promise<number[]> {
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "text-embedding-3-small",
      input: text,
      dimensions: 1536,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI embeddings API error ${response.status}: ${err}`);
  }

  const json = await response.json() as { data: Array<{ embedding: number[] }> };
  return json.data[0].embedding;
}

async function logError(
  tenantId: string,
  messageId: string,
  error: string,
): Promise<void> {
  await supabase.from("events_log").insert({
    tenant_id: tenantId,
    session_id: null,
    event_type: "error",
    payload: { messageId },
    error: `generate-embeddings: ${error}`,
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // Chamada interna — sem verificação de JWT
  let payload: EmbeddingRequest;
  try {
    payload = await req.json() as EmbeddingRequest;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const { messageId, body, tenantId, messageType } = payload;

  // Pular mensagens de sistema ou reações
  if (messageType && SKIP_TYPES.has(messageType)) {
    return new Response("Skipped: system/reaction message", { status: 200 });
  }

  // Pular se body vazio
  if (!body || body.trim().length === 0) {
    return new Response("Skipped: empty body", { status: 200 });
  }

  if (!messageId || !tenantId) {
    return new Response("Missing messageId or tenantId", { status: 400 });
  }

  // Resolver a chave do tenant (BYOK → plataforma). Sem chave → skip gracioso.
  const apiKey = await resolveTenantKey(tenantId);
  if (!apiKey) {
    return new Response("Skipped: no OpenAI key for tenant", { status: 200 });
  }

  try {
    const embedding = await generateEmbedding(body, apiKey);

    const { error: updateError } = await supabase
      .from("messages")
      .update({ embedding: embedding } as Record<string, unknown>)
      .eq("id", messageId)
      .eq("tenant_id", tenantId);

    if (updateError) {
      await logError(tenantId, messageId, `DB update failed: ${updateError.message}`);
      return new Response(`DB update error: ${updateError.message}`, { status: 500 });
    }

    return new Response("ok", { status: 200 });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await logError(tenantId, messageId, errMsg);
    return new Response(`Error: ${errMsg}`, { status: 500 });
  }
});
