import "server-only";

const GRAPH_API_VERSION = "v23.0";
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

// Mesmo raciocínio de apps/meta-ads/lib/meta/graphClient.ts: sem timeout, um
// fetch travado segura a invocação inteira até o teto de plataforma (Edge
// Function: 150s: ver regra 11 do CLAUDE.md). Teto bem menor aqui garante
// falha isolada e tratável.
const FETCH_TIMEOUT_MS = 20_000;

// Retry só em 429/5xx — 4xx de template/parâmetro inválido é definitivo, não
// adianta tentar de novo. O meta-ads não tem retry algum (aceitável pra sync
// de leitura 1x/dia); aqui é obrigatório porque a Cloud API tem limite de
// throughput por tier do número e envia 429 rotineiramente em campanhas.
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 1_000;

export class GraphApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
    readonly errorCode?: number,
    readonly errorSubcode?: number,
  ) {
    super(message);
    this.name = "GraphApiError";
  }

  /**
   * Teto de tier de mensageria (250/1K/10K/... por 24h) ou qualidade do
   * número — chega como 4xx de elegibilidade de negócio, não 429. Quem
   * chama deve pausar a campanha inteira nesse caso, não marcar o
   * destinatário como falha definitiva. Códigos documentados pela Meta:
   * 130472 (limite de experiência), 131048 (limite de spam), 131056
   * (limite de par número/destinatário).
   */
  get isMessagingLimitError(): boolean {
    return [130472, 131048, 131056].includes(this.errorCode ?? -1);
  }
}

async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    } catch (err) {
      lastError = err;
      if (attempt === MAX_RETRIES) throw err;
      await sleep(backoffDelay(attempt));
      continue;
    }

    if (response.status === 429 || response.status >= 500) {
      if (attempt === MAX_RETRIES) return response;
      const retryAfter = response.headers.get("Retry-After");
      const delay = retryAfter ? Number(retryAfter) * 1000 : backoffDelay(attempt);
      await sleep(delay);
      continue;
    }

    return response;
  }

  throw lastError;
}

function backoffDelay(attempt: number): number {
  const jitter = Math.random() * 250;
  return BASE_BACKOFF_MS * 2 ** attempt + jitter;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function parseGraphError(response: Response, context: string): Promise<GraphApiError> {
  let json: Record<string, unknown> = {};
  try {
    json = await response.json();
  } catch {
    /* corpo não-JSON, segue com objeto vazio */
  }
  const errorBody = json.error as { message?: string; code?: number; error_subcode?: number } | undefined;
  const reason = errorBody?.message ? `: ${errorBody.message}` : "";
  return new GraphApiError(
    `Graph API respondeu ${response.status} em ${context}${reason}`,
    response.status,
    errorBody ?? json,
    errorBody?.code,
    errorBody?.error_subcode,
  );
}

export interface MessageTemplate {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  components: unknown[];
}

/** GET /{waba_id}/message_templates — lista templates aprovados/pendentes. */
export async function listMessageTemplates(
  wabaId: string,
  accessToken: string,
): Promise<MessageTemplate[]> {
  const url = new URL(`${GRAPH_API_BASE}/${wabaId}/message_templates`);
  url.searchParams.set("access_token", accessToken);
  url.searchParams.set("limit", "100");

  const results: MessageTemplate[] = [];
  let nextUrl: string | undefined = url.toString();

  while (nextUrl) {
    const response = await fetchWithRetry(nextUrl, { method: "GET" });
    if (!response.ok) throw await parseGraphError(response, `${wabaId}/message_templates`);
    const json = (await response.json()) as { data: MessageTemplate[]; paging?: { next?: string } };
    results.push(...(json.data ?? []));
    nextUrl = json.paging?.next;
  }

  return results;
}

export interface SendTemplateMessageParams {
  phoneNumberId: string;
  accessToken: string;
  to: string; // E.164, sem "+"
  templateName: string;
  templateLanguage: string;
  components?: unknown[];
}

export interface SendTemplateMessageResult {
  wamid: string;
}

/** POST /{phone_number_id}/messages — envia uma mensagem de template. */
export async function sendTemplateMessage(
  params: SendTemplateMessageParams,
): Promise<SendTemplateMessageResult> {
  const { phoneNumberId, accessToken, to, templateName, templateLanguage, components } = params;

  const response = await fetchWithRetry(`${GRAPH_API_BASE}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: templateName,
        language: { code: templateLanguage },
        ...(components ? { components } : {}),
      },
    }),
  });

  if (!response.ok) throw await parseGraphError(response, `${phoneNumberId}/messages`);

  const json = (await response.json()) as { messages?: { id: string }[] };
  const wamid = json.messages?.[0]?.id;
  if (!wamid) throw new GraphApiError("Resposta sem wamid", response.status, json);

  return { wamid };
}

export interface SendFreeformTextParams {
  phoneNumberId: string;
  accessToken: string;
  to: string; // E.164, sem "+"
  body: string;
}

/**
 * POST /{phone_number_id}/messages, type "text" — mensagem livre, só
 * permitida dentro da janela de 24h desde a última mensagem inbound do
 * contato (fora disso a Graph API rejeita com erro 131047 e exige
 * template). O caller (messages/send/route.ts) checa a janela antes de
 * chamar esta função.
 */
export async function sendFreeformTextMessage(
  params: SendFreeformTextParams,
): Promise<SendTemplateMessageResult> {
  const { phoneNumberId, accessToken, to, body: text } = params;

  const response = await fetchWithRetry(`${GRAPH_API_BASE}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text },
    }),
  });

  if (!response.ok) throw await parseGraphError(response, `${phoneNumberId}/messages`);

  const json = (await response.json()) as { messages?: { id: string }[] };
  const wamid = json.messages?.[0]?.id;
  if (!wamid) throw new GraphApiError("Resposta sem wamid", response.status, json);

  return { wamid };
}
