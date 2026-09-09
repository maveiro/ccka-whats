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

/**
 * POST /{phone_number_id}/messages, type "interactive" / flow — abre um Flow
 * publicado dentro da conversa.
 *
 * É a capacidade que o PRD marca como "não reaproveita nada existente": o
 * envio de texto e de template não sabe montar esta mensagem. Sem ela, a
 * palavra-chave com tipo_resposta='abrir_flow' fica bloqueada.
 *
 * `flow_action: "data_exchange"` (e não "navigate") é o que faz o app pedir a
 * primeira tela AO ENDPOINT — é o equivalente ao "Solicitar dados" da prévia
 * do WhatsApp Manager. Com "navigate", o Flow abriria com dados estáticos e
 * nunca chamaria o endpoint, que é justamente o modo que faz parecer que
 * "nada acontece".
 */
export async function enviarFlow(params: {
  phoneNumberId: string;
  accessToken: string;
  to: string;
  flowId: string;
  flowToken: string;
  cta: string;
  corpo: string;
  cabecalho?: string;
  rodape?: string;
}): Promise<EnvioResultado> {
  const { phoneNumberId, accessToken, to, flowId, flowToken, cta, corpo, cabecalho, rodape } = params;

  const mensagem = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "interactive",
    interactive: {
      type: "flow",
      ...(cabecalho ? { header: { type: "text", text: cabecalho } } : {}),
      body: { text: corpo },
      ...(rodape ? { footer: { text: rodape } } : {}),
      action: {
        name: "flow",
        parameters: {
          flow_message_version: "3",
          flow_token: flowToken,
          flow_id: flowId,
          flow_cta: cta,
          flow_action: "data_exchange",
        },
      },
    },
  };

  return await postMensagem(phoneNumberId, accessToken, mensagem);
}

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

  return await postMensagem(phoneNumberId, accessToken, {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body },
  });
}

/** POST /{phone_number_id}/messages com retry só em 429/5xx. */
async function postMensagem(
  phoneNumberId: string,
  accessToken: string,
  mensagem: unknown,
): Promise<EnvioResultado> {
  for (let tentativa = 0; tentativa <= MAX_RETRIES; tentativa++) {
    let response: Response;
    try {
      response = await fetch(`${GRAPH_API_BASE}/${phoneNumberId}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(mensagem),
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
