// Envio via WhatsApp Cloud API (passos 8 e 9 do fluxo técnico do PRD).
//
// O PRD diz "reaproveita lib/whatsapp-cloud/graphClient.ts". Na prática não dá:
// aquele módulo vive em apps/web/lib e começa com `import "server-only"` — é
// código do Next, não do Deno, e Edge Functions aqui não têm módulo
// compartilhado (ver CLAUDE.md: "Edge Functions resolvem a chave inline, sem
// _shared"). O campaign-sender já resolveu isso do mesmo jeito: replica o
// mínimo e cita o graphClient em comentário. O que é reaproveitado é a lógica
// documentada — retry só em 429/5xx, e os códigos de erro abaixo.

const GRAPH_API_VERSION = "v23.0";
// O override existe só para o harness de teste local (supabase/tests/
// flow_engine.e2e.ts) apontar para um stub e nunca tocar a Meta de verdade.
// Em produção a env não existe e o valor é o da Graph API.
const GRAPH_API_BASE = Deno.env.get("GRAPH_API_BASE_OVERRIDE") ??
  `https://graph.facebook.com/${GRAPH_API_VERSION}`;
const FETCH_TIMEOUT_MS = 20_000;
const MAX_RETRIES = 2;
const BASE_BACKOFF_MS = 500;

// Teto de tier de mensageria / qualidade do número. Chega como 4xx de
// elegibilidade de negócio, não 429 (ver GraphApiError.isMessagingLimitError em
// apps/web/lib/whatsapp-cloud/graphClient.ts e o tratamento no campaign-sender).
// Aqui não há campanha pra pausar: loga e desiste desta resposta — nunca tenta
// de novo às cegas.
export const MESSAGING_LIMIT_CODES = new Set([130472, 131048, 131056]);
// Fora da janela de 24h para mensagem livre. Não deveria acontecer no
// flow-engine (a resposta segue um inbound recém-chegado), mas o gate pode
// responder minutos depois — então é caso logado, não exceção não tratada.
export const FORA_DA_JANELA_CODE = 131047;

export interface EnvioResultado {
  ok: boolean;
  wamid?: string;
  errorCode?: number;
  errorMessage?: string;
  status?: number;
}

function backoff(tentativa: number): number {
  return BASE_BACKOFF_MS * 2 ** tentativa + Math.random() * 200;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * POST /{phone_number_id}/messages, type "text".
 * Nunca lança: devolve o resultado para quem chama decidir o que logar. Uma
 * exceção aqui derrubaria o processamento da mensagem inteira, e o PRD é
 * explícito que uma falha de envio não pode fazer a captura se perder.
 */
export async function enviarTexto(params: {
  phoneNumberId: string;
  accessToken: string;
  to: string; // E.164 sem "+"
  body: string;
}): Promise<EnvioResultado> {
  const { phoneNumberId, accessToken, to, body } = params;

  for (let tentativa = 0; tentativa <= MAX_RETRIES; tentativa++) {
    let response: Response;
    try {
      response = await fetch(`${GRAPH_API_BASE}/${phoneNumberId}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: "text",
          text: { body },
        }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch (err) {
      if (tentativa === MAX_RETRIES) {
        return { ok: false, errorMessage: err instanceof Error ? err.message : String(err) };
      }
      await sleep(backoff(tentativa));
      continue;
    }

    // 429/5xx: transitório, vale nova tentativa. 4xx: definitivo.
    if ((response.status === 429 || response.status >= 500) && tentativa < MAX_RETRIES) {
      await sleep(backoff(tentativa));
      continue;
    }

    const json = await response.json().catch(() => ({} as Record<string, unknown>));

    if (!response.ok) {
      const erro = (json as Record<string, unknown>).error as
        | { message?: string; code?: number }
        | undefined;
      return {
        ok: false,
        status: response.status,
        errorCode: erro?.code,
        errorMessage: erro?.message ?? `HTTP ${response.status}`,
      };
    }

    const wamid = (json as { messages?: { id: string }[] }).messages?.[0]?.id;
    if (!wamid) return { ok: false, status: response.status, errorMessage: "resposta sem wamid" };
    return { ok: true, wamid };
  }

  return { ok: false, errorMessage: "esgotou tentativas" };
}
