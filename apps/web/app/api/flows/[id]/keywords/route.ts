import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Palavras-chave de um Flow. Acesso herda a RLS de whatsapp_flows via
// flow_palavras_chave (migration 0025): admin e operator com acesso ao número
// criam/editam; exclusão é admin-only.

// `abrir_flow` deixou de ser bloqueado quando a Trilha B entregou o envio de
// mensagem interativa com token de Flow. Continua exigindo um Flow de destino
// com meta_flow_id — sem o ID publicado na Meta não há o que abrir.
const TIPOS_PERMITIDOS = new Set(["texto", "link", "abrir_flow"]);

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
    flowDestinoId?: unknown;
  };

  const palavraChave = typeof body.palavraChave === "string" ? body.palavraChave.trim() : "";
  const tipoResposta = typeof body.tipoResposta === "string" ? body.tipoResposta : "texto";
  const resposta = typeof body.resposta === "string" ? body.resposta.trim() : "";

  const flowDestinoId = typeof body.flowDestinoId === "string" ? body.flowDestinoId : null;

  if (!palavraChave) return NextResponse.json({ error: "Palavra-chave é obrigatória" }, { status: 400 });
  if (tipoResposta !== "abrir_flow" && !resposta) {
    return NextResponse.json({ error: "Resposta é obrigatória" }, { status: 400 });
  }
  if (tipoResposta === "abrir_flow" && !flowDestinoId) {
    return NextResponse.json({ error: "Escolha o Flow que a palavra-chave deve abrir" }, { status: 400 });
  }

  if (!TIPOS_PERMITIDOS.has(tipoResposta)) {
    return NextResponse.json({ error: "Tipo de resposta inválido" }, { status: 400 });
  }

  // O Flow de destino precisa estar publicado na Meta: sem meta_flow_id, a
  // palavra-chave existiria e nunca abriria nada. A checagem de mesmo número e
  // tipo agenda_shows/central é feita pelo trigger da migration 0025.
  if (flowDestinoId) {
    const { data: destino } = await supabase
      .from("whatsapp_flows")
      .select("id, meta_flow_id")
      .eq("id", flowDestinoId)
      .eq("ativo", true)
      .is("deleted_at", null)
      .maybeSingle<{ id: string; meta_flow_id: string | null }>();

    if (!destino) return NextResponse.json({ error: "Flow de destino não encontrado" }, { status: 404 });
    if (!destino.meta_flow_id) {
      return NextResponse.json(
        { error: "Este Flow ainda não foi publicado na Meta — sem isso a palavra-chave não abriria nada" },
        { status: 400 },
      );
    }
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
      resposta: tipoResposta === "abrir_flow" ? null : resposta,
      flow_destino_id: flowDestinoId,
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
