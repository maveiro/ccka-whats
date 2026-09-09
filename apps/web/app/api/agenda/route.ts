import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Agenda de shows (agenda_shows_sync) — V1 do PRD: preenchida MANUALMENTE por
// esta interface. Na V2, a mesma tabela passa a ser preenchida por um job de
// sincronização a partir do painel-shows, sem mudar nada do endpoint do Flow.
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
    .select("id, show_id_origem, artista, cidade, teatro, data_show, status_venda, link_compra, updated_at")
    .order("data_show", { ascending: true, nullsFirst: false });

  if (artista) query = query.eq("artista", artista);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: operator } = await supabase
    .from("operators")
    .select("role, tenant_id")
    .eq("id", user.id)
    .single<{ role: string; tenant_id: string }>();

  if (!operator || !["admin", "operator"].includes(operator.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json() as Record<string, unknown>;

  const artista = typeof body.artista === "string" ? body.artista.trim() : "";
  if (!artista) return NextResponse.json({ error: "Artista é obrigatório" }, { status: 400 });

  const dataShow = typeof body.dataShow === "string" && body.dataShow ? new Date(body.dataShow) : null;
  if (dataShow && Number.isNaN(dataShow.getTime())) {
    return NextResponse.json({ error: "Data do show inválida" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("agenda_shows_sync")
    .insert({
      tenant_id: operator.tenant_id,
      artista,
      cidade: texto(body.cidade),
      teatro: texto(body.teatro),
      data_show: dataShow?.toISOString() ?? null,
      status_venda: texto(body.statusVenda),
      link_compra: texto(body.linkCompra),
      // show_id_origem fica nulo na V1: é a referência ao painel-shows, e o
      // índice único parcial só vale quando ele existe — várias linhas manuais
      // coexistem sem conflito.
    })
    .select("id, show_id_origem, artista, cidade, teatro, data_show, status_venda, link_compra, updated_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

function texto(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
