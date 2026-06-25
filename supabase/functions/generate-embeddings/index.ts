import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

// Tipos de mensagem que não devem gerar embeddings
const SKIP_TYPES = new Set(["system", "reaction"]);

interface EmbeddingRequest {
  messageId: string;
  body: string;
  tenantId: string;
  messageType?: string;
}

async function generateEmbedding(text: string): Promise<number[]> {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
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

  // OpenAI é opcional — silenciar quando a chave não estiver configurada
  if (!OPENAI_API_KEY) {
    return new Response("Skipped: OPENAI_API_KEY not configured", { status: 200 });
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

  try {
    const embedding = await generateEmbedding(body);

    const { error: updateError } = await supabase
      .from("messages")
      .update({ embedding: JSON.stringify(embedding) } as Record<string, unknown>)
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
