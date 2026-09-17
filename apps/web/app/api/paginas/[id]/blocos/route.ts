import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { autorizarPagina } from "@/lib/paginas-auth";

const TIPOS = ["texto", "link", "imagem", "agenda"];

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await autorizarPagina();
  if ("erro" in auth) return auth.erro;
  const { id: paginaId } = await params;

  const body = await req.json() as { tipo?: unknown; conteudo?: unknown };
  const tipo = typeof body.tipo === "string" ? body.tipo : "";
  if (!TIPOS.includes(tipo)) {
    return NextResponse.json({ error: `Tipo inválido (use ${TIPOS.join(", ")})` }, { status: 400 });
  }

  const supabase = await createClient();

  // Ordem: sempre no fim. Bloco novo aparecendo no meio da página sem
  // ninguém pedir é o tipo de surpresa que faz alguém republicar errado.
  const { data: ultimo } = await supabase
    .from("pagina_blocos")
    .select("ordem")
    .eq("pagina_id", paginaId)
    .order("ordem", { ascending: false })
    .limit(1)
    .maybeSingle<{ ordem: number }>();

  const { data, error } = await supabase
    .from("pagina_blocos")
    .insert({
      pagina_id: paginaId,
      tenant_id: auth.tenantId,
      tipo,
      ordem: (ultimo?.ordem ?? 0) + 10,
      conteudo: (body.conteudo && typeof body.conteudo === "object" ? body.conteudo : {}) as Record<string, unknown>,
    })
    .select("id, tipo, ordem, conteudo, ativo, cliques")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

/** Reordenação: a tela manda a sequência inteira, não um "sobe/desce" por vez. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await autorizarPagina();
  if ("erro" in auth) return auth.erro;
  const { id: paginaId } = await params;

  const body = await req.json() as { ordem?: unknown };
  const ids = Array.isArray(body.ordem) ? body.ordem.filter((i): i is string => typeof i === "string") : [];
  if (ids.length === 0) return NextResponse.json({ error: "Ordem vazia" }, { status: 400 });

  const supabase = await createClient();
  // Um update por bloco: são poucos (uma página tem dezenas, não milhares), e
  // a alternativa (uma função no banco) só se paga se isso crescer.
  for (const [indice, id] of ids.entries()) {
    const { error } = await supabase
      .from("pagina_blocos")
      .update({ ordem: (indice + 1) * 10 })
      .eq("id", id)
      .eq("pagina_id", paginaId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
