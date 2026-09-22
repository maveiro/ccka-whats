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

export interface PricingAnalyticsPoint {
  start: number;
  end: number;
  country?: string;
  phone_number?: string;
  pricing_type?: string;
  pricing_category?: string;
  tier?: string;
  volume?: number;
  cost?: number;
}

/**
 * GET /{waba_id}?fields=pricing_analytics — agregado OFICIAL de custo da
 * Meta, usado só como conferência contra o ledger local
 * (whatsapp_message_costs). Duas ressalvas documentadas pela própria Meta,
 * repassadas na UI: o valor é aproximado e pode divergir da fatura, e não
 * vem nada quando a WABA é faturada por Solution Partner.
 * Lookback máximo: 1 ano.
 */
export async function getPricingAnalytics(
  wabaId: string,
  accessToken: string,
  params: { start: Date; end: Date; granularity?: "DAILY" | "MONTHLY" | "HALF_HOUR" },
): Promise<PricingAnalyticsPoint[]> {
  const start = Math.floor(params.start.getTime() / 1000);
  const end = Math.floor(params.end.getTime() / 1000);
  const granularity = params.granularity ?? "DAILY";

  // O campo é um "field expression" com os parâmetros embutidos no próprio
  // fields= — não são query params soltos.
  const field =
    `pricing_analytics.start(${start}).end(${end}).granularity(${granularity})` +
    `.metric_types(["COST","VOLUME"])` +
    `.dimensions(["PRICING_CATEGORY","PRICING_TYPE","COUNTRY","PHONE"])`;

  const url = new URL(`${GRAPH_API_BASE}/${wabaId}`);
  url.searchParams.set("fields", field);
  url.searchParams.set("access_token", accessToken);

  const response = await fetchWithRetry(url.toString(), { method: "GET" });
  if (!response.ok) throw await parseGraphError(response, `${wabaId}?fields=pricing_analytics`);

  const json = (await response.json()) as {
    pricing_analytics?: { data?: { data_points?: PricingAnalyticsPoint[] }[] };
  };

  return json.pricing_analytics?.data?.flatMap((d) => d.data_points ?? []) ?? [];
}

export interface MessageTemplate {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  components: unknown[];
  /** Só vem preenchido quando status é REJECTED. */
  rejected_reason?: string;
  /** "GREEN" | "YELLOW" | "RED" | "UNKNOWN" — não vem em template recém-criado. */
  quality_score?: { score?: string } | null;
}

// `rejected_reason` e `quality_score` NÃO vêm no retorno padrão da Graph
// API — é preciso pedir explicitamente em `fields`. Descoberto montando a
// tela de status (22/09/2026): sem isto, um template rejeitado aparecia na
// lista sem dizer o motivo, obrigando a abrir o WhatsApp Manager para saber
// por quê — exatamente o que esta tela existe para evitar.
const CAMPOS_TEMPLATE = "id,name,language,category,status,components,rejected_reason,quality_score";

/**
 * GET /{waba_id}/message_templates — lista TODO template da WABA, qualquer
 * status (aprovado, pendente, rejeitado). Quem filtra por status é o
 * chamador: `/api/campaigns/templates` quer só APPROVED (é o que se pode
 * disparar); `/api/templates` quer todos (é a tela de gestão).
 */
export async function listMessageTemplates(
  wabaId: string,
  accessToken: string,
): Promise<MessageTemplate[]> {
  const url = new URL(`${GRAPH_API_BASE}/${wabaId}/message_templates`);
  url.searchParams.set("access_token", accessToken);
  url.searchParams.set("fields", CAMPOS_TEMPLATE);
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

// ─── Upload de mídia para cabeçalho de template ──────────────────────────────
//
// Header de mídia (imagem/vídeo/documento) exige um `header_handle` de
// EXEMPLO — a Meta pede para ver a mídia antes de aprovar. O handle vem da
// Resumable Upload API, um subsistema separado do resto da Graph API:
//
//  1. POST /{app_id}/uploads?file_name&file_length&file_type → sessão
//  2. POST /{sessão} com o BINÁRIO no corpo e Authorization: OAuth <token>
//     (não "Bearer" — a doc é explícita sobre isso, e é a única chamada da
//     Graph API neste arquivo que usa esse esquema) → devolve `h`, o handle
//  3. `example.header_handle: [h]` no componente HEADER da criação/edição
//
// `app_id` não é um valor que já tínhamos guardado em lugar nenhum — as
// credenciais salvam waba_id/phone_number_id/access_token, nunca o app da
// Meta que emitiu o token. Resolvido via `debug_token`, que qualquer token
// válido consegue perguntar sobre SI MESMO (input_token === access_token):
// evita um env var novo, e continua certo mesmo que WABAs diferentes usem
// apps da Meta diferentes (o CLAUDE.md já registra 3 apps inscritos na WABA
// da Plauz).
//
// Validado ao vivo em 22/09/2026: sessão criada, PNG de teste enviado,
// handle usado para criar um template com cabeçalho IMAGE de verdade
// (`status: PENDING`), depois apagado — era só teste.

export async function resolveAppId(accessToken: string): Promise<string> {
  const url = new URL(`${GRAPH_API_BASE}/debug_token`);
  url.searchParams.set("input_token", accessToken);
  url.searchParams.set("access_token", accessToken);

  const response = await fetchWithRetry(url.toString(), { method: "GET" });
  if (!response.ok) throw await parseGraphError(response, "debug_token");

  const json = (await response.json()) as { data?: { app_id?: string } };
  const appId = json.data?.app_id;
  if (!appId) throw new GraphApiError("debug_token não devolveu app_id", response.status, json);
  return appId;
}

export async function createUploadSession(params: {
  appId: string;
  accessToken: string;
  fileName: string;
  fileLength: number;
  fileType: string;
}): Promise<string> {
  const { appId, accessToken, fileName, fileLength, fileType } = params;
  const url = new URL(`${GRAPH_API_BASE}/${appId}/uploads`);
  url.searchParams.set("file_name", fileName);
  url.searchParams.set("file_length", String(fileLength));
  url.searchParams.set("file_type", fileType);
  url.searchParams.set("access_token", accessToken);

  const response = await fetchWithRetry(url.toString(), { method: "POST" });
  if (!response.ok) throw await parseGraphError(response, `${appId}/uploads`);

  const json = (await response.json()) as { id?: string };
  if (!json.id) throw new GraphApiError("uploads não devolveu id de sessão", response.status, json);
  return json.id; // já vem como "upload:<...>" — usado como está no passo 2
}

export async function uploadFileBytes(params: {
  uploadSessionId: string;
  accessToken: string;
  bytes: Uint8Array;
}): Promise<string> {
  const { uploadSessionId, accessToken, bytes } = params;

  const response = await fetchWithRetry(`${GRAPH_API_BASE}/${uploadSessionId}`, {
    method: "POST",
    headers: {
      // OAuth, não Bearer — único lugar neste arquivo assim (doc da Meta).
      Authorization: `OAuth ${accessToken}`,
      "file_offset": "0",
      "Content-Type": "application/octet-stream",
    },
    // Uint8Array é um BodyInit válido em runtime (fetch/undici aceitam),
    // mas o typing do DOM lib discorda dependendo da versão — cast local,
    // sem afrouxar tipo em lugar nenhum mais.
    body: bytes as unknown as BodyInit,
  });
  if (!response.ok) throw await parseGraphError(response, uploadSessionId);

  const json = (await response.json()) as { h?: string };
  if (!json.h) throw new GraphApiError("upload não devolveu handle (h)", response.status, json);
  return json.h;
}

export interface CreateMessageTemplateParams {
  wabaId: string;
  accessToken: string;
  name: string;
  language: string;
  category: "MARKETING" | "UTILITY";
  components: unknown[];
}

export interface CreateMessageTemplateResult {
  id: string;
  status: string;
  category: string;
}

/**
 * POST /{waba_id}/message_templates — cria e submete um template para
 * revisão (docs/prd/prd-criacao-de-templates.md). A Meta pode devolver uma
 * `category` diferente da pedida já na criação — sinalizado ao chamador
 * como qualquer outro campo da resposta, não é tratado como erro.
 *
 * Erros comuns que o CALLER precisa exibir como veio, sem reescrever: nome
 * duplicado (name+language já existe nesta WABA), variável sem exemplo, e
 * limite de 100 criações/hora por WABA — nenhum dos três compensa duplicar
 * a validação da Meta aqui, ela muda mais rápido do que este arquivo.
 */
export async function createMessageTemplate(
  params: CreateMessageTemplateParams,
): Promise<CreateMessageTemplateResult> {
  const { wabaId, accessToken, name, language, category, components } = params;

  const response = await fetchWithRetry(`${GRAPH_API_BASE}/${wabaId}/message_templates`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ name, language, category, components }),
  });

  if (!response.ok) throw await parseGraphError(response, `${wabaId}/message_templates (criar)`);

  const json = (await response.json()) as CreateMessageTemplateResult;
  return json;
}

/**
 * POST /{template_id} — edita um template EXISTENTE.
 *
 * Achado testando contra a Graph API real (22/09/2026): a Meta recusa editar
 * um template `PENDING` (`error_subcode 2388003`, *"Os modelos de mensagem
 * só podem ser editados se tiverem sido rejeitados"*). Ou seja, este
 * endpoint só serve para REJECTED — não é uma via geral de atualizar
 * template aprovado. Não duplicamos essa checagem aqui: o erro da Meta já
 * diz por quê, e é repassado como veio (mesmo espírito da regra de não
 * duplicar a combinação exata de botões).
 *
 * `name` e `language` NÃO entram — são a identidade do template, fixadas na
 * criação. O que dá para mudar é `category` e `components`.
 */
export async function updateMessageTemplate(params: {
  templateId: string;
  accessToken: string;
  category?: "MARKETING" | "UTILITY";
  components: unknown[];
}): Promise<{ success: boolean }> {
  const { templateId, accessToken, category, components } = params;

  const response = await fetchWithRetry(`${GRAPH_API_BASE}/${templateId}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ ...(category ? { category } : {}), components }),
  });

  if (!response.ok) throw await parseGraphError(response, `${templateId} (editar)`);

  return (await response.json()) as { success: boolean };
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
