import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

// Exclusão REAL dos dados pessoais de um cliente (LGPD) — requisito explícito
// do PRD, que registra que o soft-delete usado no resto do projeto não serve
// aqui: o dado continuaria existindo.
//
// O que é apagado: nome, e-mail e mensagem_pendente (texto livre escrito pelo
// titular). O que permanece: telefone — é a chave que liga a conversa ao
// histórico de mensagens, que segue a governança do resto do produto. Apagar o
// telefone quebraria o histórico sem apagar o conteúdo das mensagens, que é
// onde o dado pessoal realmente está.
//
// Este é um DELETE de conteúdo, não de linha: a linha permanece com
// pii_apagada_em preenchido, e é isso que impede o gate de pedir o nome de
// novo no próximo contato — sem o carimbo, a automação reverteria na prática o
// direito que a pessoa exerceu.

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
    return NextResponse.json({ error: "Só admin pode apagar dados pessoais" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("clientes")
    .update({
      nome: null,
      email: null,
      mensagem_pendente: null,
      pii_apagada_em: new Date().toISOString(),
      // Fecha o gate: sem isso, um cliente que estivesse no meio do cadastro
      // voltaria a ser perguntado logo na mensagem seguinte.
      cadastro_completo: true,
      aguardando_campo: null,
      tentativas_campo_atual: 0,
    })
    .eq("id", id)
    .is("deleted_at", null)
    .select("id, telefone, pii_apagada_em")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Cliente não encontrado" }, { status: 404 });

  // Trilha de auditoria: registra QUE apagou e para qual telefone, nunca o
  // conteúdo apagado — um log que guardasse o nome derrotaria o propósito.
  const admin = createAdminClient();
  await admin.from("events_log").insert({
    tenant_id: operator.tenant_id,
    session_id: null,
    event_type: "cliente_pii_apagada",
    payload: { clienteId: data.id, telefone: data.telefone, porOperador: user.id },
  });

  return NextResponse.json(data);
}
