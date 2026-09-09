import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Palavras-chave de um Flow. Acesso herda a RLS de whatsapp_flows via
// flow_palavras_chave (migration 0025): admin e operator com acesso ao número
// criam/editam; exclusão é admin-only.

const TIPOS_PERMITIDOS = new Set(["texto", "link"]);

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id: flowId } = await ctx.params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: operator } = await supabase
    .from("operators")
    .select("tenant_id")
    .eq("id", user.id)
    .single<{ tenant_id: string }>();
  if (!operator) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json() as {
    palavraChave?: unknown;
    tipoResposta?: unknown;
    resposta?: unknown;
  };

  const palavraChave = typeof body.palavraChave === "string" ? body.palavraChave.trim() : "";
  const tipoResposta = typeof body.tipoResposta === "string" ? body.tipoResposta : "texto";
  const resposta = typeof body.resposta === "string" ? body.resposta.trim() : "";

  if (!palavraChave) return NextResponse.json({ error: "Palavra-chave é obrigatória" }, { status: 400 });
  if (!resposta) return NextResponse.json({ error: "Resposta é obrigatória" }, { status: 400 });

  // `abrir_flow` existe no schema mas depende da Trilha B (mensagem interativa
  // com token de Flow, que o envio de hoje não sabe montar) — o flow-engine
  // trata como bloqueado. Não deixar cadastrar evita criar uma keyword que
  // nunca responde.
  if (!TIPOS_PERMITIDOS.has(tipoResposta)) {
    return NextResponse.json(
      { error: "Tipo de resposta indisponível nesta versão (abrir_flow depende da agenda de shows)" },
      { status: 400 },
    );
  }

  // Confere que o Flow existe e é visível para quem pede (a RLS do insert
  // abaixo também barraria, mas com erro de policy em vez de mensagem útil).
  const { data: flow } = await supabase
    .from("whatsapp_flows")
    .select("id")
    .eq("id", flowId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!flow) return NextResponse.json({ error: "Flow não encontrado" }, { status: 404 });

  const { data, error } = await supabase
    .from("flow_palavras_chave")
    .insert({
      tenant_id: operator.tenant_id,
      flow_id: flowId,
      palavra_chave: palavraChave,
      tipo_resposta: tipoResposta,
      resposta,
    })
    .select("id, palavra_chave, tipo_resposta, resposta, flow_destino_id")
    .single();

  if (error) {
    // Índice único (flow_id, lower(palavra_chave)) — duas keywords iguais no
    // mesmo Flow tornariam o match não-determinístico.
    const duplicada = error.code === "23505";
    return NextResponse.json(
      { error: duplicada ? "Esta palavra-chave já existe neste Flow" : error.message },
      { status: duplicada ? 409 : 500 },
    );
  }

  return NextResponse.json(data, { status: 201 });
}
