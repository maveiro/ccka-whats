import { createAdminClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import type { SupabaseClient } from "@supabase/supabase-js";

export type OpenAIKeySource = "byok" | "platform" | null;

export interface ResolvedKey {
  key: string | null;
  source: OpenAIKeySource;
}

/**
 * Resolve a chave OpenAI para o tenant do operador autenticado.
 *
 * Ordem: override do tenant (BYOK, em `integrations`) → chave da plataforma
 * (`env.OPENAI_API_KEY`, embutida/cobrável) → null.
 *
 * SEGURANÇA: a assinatura recebe o client AUTENTICADO e deriva o `tenant_id`
 * dele mesmo (auth.getUser → operators). Nunca aceita tenantId vindo do client
 * → IDOR impossível. A leitura de `integrations` usa createAdminClient (a tabela
 * é admin-only RLS), por isso o `.eq("tenant_id", ...)` é obrigatório (exceção
 * legítima à regra 15: o admin client bypassa RLS).
 *
 * Nunca loga a chave.
 */
export async function getTenantOpenAIKey(
  supabase: SupabaseClient,
): Promise<ResolvedKey> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { key: null, source: null };

  const { data: operator } = await supabase
    .from("operators")
    .select("tenant_id")
    .eq("id", user.id)
    .single();

  const tenantId = operator?.tenant_id as string | undefined;
  if (!tenantId) {
    return resolvePlatform();
  }

  const admin = createAdminClient();
  const { data: integration } = await admin
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
  if (byok && byok.length > 0) {
    return { key: byok, source: "byok" };
  }

  return resolvePlatform();
}

function resolvePlatform(): ResolvedKey {
  const platform = env.OPENAI_API_KEY;
  return platform ? { key: platform, source: "platform" } : { key: null, source: null };
}

export type ValidateReason = "invalid" | "no_quota" | "network";

export interface ValidateResult {
  ok: boolean;
  reason?: ValidateReason;
}

/**
 * Valida uma chave OpenAI com uma chamada MÍNIMA de embeddings (custo ~zero).
 * Importante: NÃO usar /v1/models — ele retorna 200 mesmo numa conta sem
 * créditos, dando falsa sensação de "funciona". A chamada de embeddings exerce
 * a quota de verdade e detecta `insufficient_quota`.
 * Distingue inválida (401) / sem quota (429) / erro de rede. Não loga a chave.
 */
export async function validateOpenAIKey(key: string): Promise<ValidateResult> {
  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: "text-embedding-3-small", input: "ping", dimensions: 1536 }),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    return { ok: false, reason: "network" };
  }

  if (res.ok) return { ok: true };
  if (res.status === 401) return { ok: false, reason: "invalid" };
  // 429 = quota esgotada (insufficient_quota) ou rate limit — ambos impedem uso agora
  if (res.status === 429) return { ok: false, reason: "no_quota" };
  return { ok: false, reason: "invalid" };
}

/** Mascara uma chave para exibição: ••••••••1234 (últimos 4). */
export function mask(key: string): string {
  return `••••••••${key.slice(-4)}`;
}
