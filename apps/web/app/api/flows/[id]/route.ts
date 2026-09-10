import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

// PATCH: editar Flow (admin e operator, via RLS has_cloud_credential_access).
// DELETE: soft-delete, admin-only (regra 21 — simetria com sessões).
// Next.js 16: `params` é Promise, sempre await (ver apps/web/AGENTS.md).

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json() as {
    nome?: unknown;
    artista?: unknown;
    mensagemBoasVindas?: unknown;
    mensagemFallback?: unknown;
    ativo?: unknown;
    mensagemConvite?: unknown;
  };

  const patch: Record<string, unknown> = {};
  if (typeof body.nome === "string" && body.nome.trim()) patch.nome = body.nome.trim();
  if (typeof body.artista === "string") patch.artista = body.artista.trim() || null;
  if (typeof body.mensagemBoasVindas === "string") {
    patch.mensagem_boas_vindas = body.mensagemBoasVindas.trim() || null;
  }
  if (typeof body.mensagemConvite === "string") {
    patch.mensagem_convite = body.mensagemConvite.trim() || null;
  }
  if (typeof body.mensagemFallback === "string") {
    patch.mensagem_fallback = body.mensagemFallback.trim() || null;
  }
  if (typeof body.ativo === "boolean") patch.ativo = body.ativo;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nada para atualizar" }, { status: 400 });
  }

  // Ativar um Flow é o que faz o motor começar a responder de verdade: sem
  // fallback cadastrado, toda mensagem que não bate keyword vira silêncio (o
  // flow-engine só envia se mensagem_fallback existir). Melhor barrar aqui com
  // uma mensagem clara do que deixar o operador achar que ativou e nada
  // acontecer.
  if (patch.ativo === true) {
    const { data: atual } = await supabase
      .from("whatsapp_flows")
      .select("mensagem_fallback, flow_palavras_chave!flow_palavras_chave_flow_id_fkey(id, deleted_at)")
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle<{ mensagem_fallback: string | null; flow_palavras_chave: { id: string; deleted_at: string | null }[] }>();

    if (!atual) return NextResponse.json({ error: "Flow não encontrado" }, { status: 404 });

    const keywords = (atual.flow_palavras_chave ?? []).filter((k) => k.deleted_at === null);
    if (keywords.length === 0) {
      return NextResponse.json(
        { error: "Cadastre ao menos uma palavra-chave antes de ativar" },
        { status: 400 },
      );
    }
    if (!atual.mensagem_fallback) {
      return NextResponse.json(
        { error: "Defina a mensagem de fallback antes de ativar — sem ela, quem não bate keyword não recebe resposta nenhuma" },
        { status: 400 },
      );
    }
  }

  const { data, error } = await supabase
    .from("whatsapp_flows")
    .update(patch)
    .eq("id", id)
    .is("deleted_at", null)
    .select("id, cloud_credential_id, artista, nome, tipo, ativo, mensagem_convite, mensagem_boas_vindas, mensagem_fallback, created_at")
    .maybeSingle();

  if (error) {
    const conflito = error.code === "23505";
    return NextResponse.json(
      { error: conflito ? "Já existe um Flow ativo deste tipo para este número" : error.message },
      { status: conflito ? 409 : 500 },
    );
  }
  // RLS filtrou: ou não existe, ou o operador não tem acesso a esse número.
  if (!data) return NextResponse.json({ error: "Flow não encontrado" }, { status: 404 });

  return NextResponse.json(data);
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: operator } = await supabase
    .from("operators")
    .select("role, tenant_id")
    .eq("id", user.id)
    .single<{ role: string; tenant_id: string }>();

  if (operator?.role !== "admin") {
    return NextResponse.json({ error: "Só admin pode excluir um Flow" }, { status: 403 });
  }

  // Soft-delete: flow_contato_estado e clientes referenciam o Flow, e o
  // histórico de quem conversou com a automação não deve sumir junto.
  const agora = new Date().toISOString();
  const { data, error } = await supabase
    .from("whatsapp_flows")
    .update({ deleted_at: agora, ativo: false })
    .eq("id", id)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Flow não encontrado" }, { status: 404 });

  await supabase
    .from("flow_palavras_chave")
    .update({ deleted_at: agora })
    .eq("flow_id", id)
    .is("deleted_at", null);

  const admin = createAdminClient();
  await admin.from("events_log").insert({
    tenant_id: operator.tenant_id,
    session_id: null,
    event_type: "flow_excluido",
    payload: { flowId: id },
  });

  return NextResponse.json({ ok: true });
}
