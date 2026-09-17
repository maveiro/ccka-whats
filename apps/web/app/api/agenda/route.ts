import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Agenda de shows (agenda_shows_sync) — LEITURA. A tabela é preenchida pelo
// sync com o board do Monday (Edge Function agenda-sync, via painel-shows).
//
// O POST que cadastrava show à mão foi removido em 16/09/2026 (decisão do
// fundador: a agenda vem sempre do Monday). PATCH e DELETE em /[id]
// continuam, para corrigir e limpar as linhas que sobraram daquela época —
// linha sincronizada a tela não deixa editar, porque a rodada seguinte
// desfaria.
//
// Autorização é da RLS (migration 0025): leitura para todo o tenant, escrita
// para admin e operator, exclusão admin-only. Sem `.eq("tenant_id")`
// redundante (regra 15) — o client autenticado já é filtrado.
//
// Não é escopada por número/sessão de propósito: agenda é dado de ARTISTA, e o
// mesmo show pode ser divulgado por mais de um número.

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const artista = new URL(req.url).searchParams.get("artista");

  let query = supabase
    .from("agenda_shows_sync")
    .select("id, show_id_origem, artista, cidade, teatro, data_show, status_venda, link_compra, publicado, updated_at")
    .order("data_show", { ascending: true, nullsFirst: false });

  if (artista) query = query.eq("artista", artista);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}
