import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getTenantOpenAIKey } from "@/lib/ai";

type Period = "last50" | "today" | "7d" | "30d" | "all";

const MAX_MESSAGES = 400;   // teto de mensagens p/ controlar custo/contexto
const MAX_BODY = 600;       // truncar cada mensagem

interface MsgRow {
  body: string | null;
  caption: string | null;
  type: string;
  from_me: boolean;
  timestamp: string;
  contacts: { push_name: string | null; name: string | null } | { push_name: string | null; name: string | null }[] | null;
}

function cutoffFor(period: Period): string | null {
  // Brasil = UTC-3 (sem horário de verão desde 2019)
  const now = Date.now();
  if (period === "today") {
    const brt = new Date(now - 3 * 3600_000);
    const startBrtUtc = Date.UTC(brt.getUTCFullYear(), brt.getUTCMonth(), brt.getUTCDate()) + 3 * 3600_000;
    return new Date(startBrtUtc).toISOString();
  }
  if (period === "7d") return new Date(now - 7 * 86400_000).toISOString();
  if (period === "30d") return new Date(now - 30 * 86400_000).toISOString();
  return null; // last50 / all
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { key: apiKey } = await getTenantOpenAIKey(supabase);
  if (!apiKey) return NextResponse.json({ error: "IA não configurada" }, { status: 503 });

  const body = await req.json().catch(() => ({})) as { period?: unknown; focus?: unknown };
  const period: Period = (["last50", "today", "7d", "30d", "all"] as const).includes(body.period as Period)
    ? (body.period as Period)
    : "last50";
  const focus = typeof body.focus === "string" ? body.focus.trim().slice(0, 200) : "";

  // Buscar mensagens (RLS filtra por tenant). last50 = últimas 50; períodos = janela + teto.
  let query = supabase
    .from("messages")
    .select("body, caption, type, from_me, timestamp, contacts ( push_name, name )")
    .eq("chat_id", id)
    .neq("type", "reaction")
    .order("timestamp", { ascending: false })
    .limit(period === "last50" ? 50 : MAX_MESSAGES);

  const cutoff = cutoffFor(period);
  if (cutoff) query = query.gte("timestamp", cutoff);

  const { data: rows, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const msgs = (rows ?? []) as MsgRow[];
  if (msgs.length === 0) {
    return NextResponse.json({ error: "Sem mensagens no período selecionado" }, { status: 400 });
  }

  // Ordem cronológica e montar transcript
  const chronological = [...msgs].reverse();
  const transcript = chronological
    .map((m) => {
      const c = Array.isArray(m.contacts) ? m.contacts[0] ?? null : m.contacts;
      const sender = m.from_me ? "Empresa" : (c?.push_name ?? c?.name ?? "Cliente");
      let text = (m.body ?? m.caption ?? "").trim().slice(0, MAX_BODY);
      if (!text) text = m.type === "text" ? "" : `[${m.type}]`;
      return text ? `${sender}: ${text}` : null;
    })
    .filter(Boolean)
    .join("\n");

  const focusBlock = focus
    ? `\nFOCO DO GESTOR: concentre o resumo em "${focus}". Priorize o que se relaciona a esse assunto e omita o que não for relevante a ele. Se o assunto não aparecer na conversa, diga isso claramente.\n`
    : "";

  const prompt = `Você é um analista de comunicação. Resuma a conversa de WhatsApp abaixo para um gestor que NÃO acompanhou o atendimento. Seja objetivo e use português do Brasil.
${focusBlock}
Responda em markdown com estas seções (omita uma seção se não houver informação):
**Resumo** — 2-3 frases do que aconteceu${focus ? ` sobre "${focus}"` : ""}.
**Pontos principais** — bullets dos temas tratados.
**Pendências** — o que ficou em aberto / aguardando resposta.
**Sentimento do cliente** — neutro/positivo/negativo + por quê.
**Próximos passos** — ações recomendadas.

Não envolva a resposta em blocos de código (\`\`\`). Comece direto pela primeira seção.

Conversa:
${transcript}`;

  let summary: string;
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: 700,
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => `HTTP ${res.status}`);
      const reason = res.status === 429 ? "Sem créditos/quota na OpenAI" : `OpenAI ${res.status}`;
      return NextResponse.json({ error: reason, detail: errText.slice(0, 200) }, { status: 502 });
    }
    const json = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    summary = json.choices?.[0]?.message?.content?.trim() ?? "";
    // Remover cerca de código se o modelo embrulhar em ```markdown ... ```
    summary = summary.replace(/^```[a-zA-Z]*\n?/, "").replace(/\n?```$/, "").trim();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `Falha ao gerar resumo: ${msg}` }, { status: 502 });
  }

  if (!summary) return NextResponse.json({ error: "Resumo vazio" }, { status: 502 });

  // events_log (governança) — sem conteúdo nem chave
  const admin = createAdminClient();
  const { data: me } = await supabase.from("operators").select("tenant_id").eq("id", user.id).single();
  if (me?.tenant_id) {
    await admin.from("events_log").insert({
      tenant_id: me.tenant_id,
      session_id: null,
      event_type: "summary_generated",
      payload: { chatId: id, period, messageCount: msgs.length, by: user.id },
      error: null,
    });
  }

  return NextResponse.json({ summary, period, messageCount: msgs.length });
}
