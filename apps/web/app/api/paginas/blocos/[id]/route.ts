import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { autorizarPagina } from "@/lib/paginas-auth";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await autorizarPagina();
  if ("erro" in auth) return auth.erro;
  const { id } = await params;

  const body = await req.json() as { conteudo?: unknown; ativo?: unknown };
  const patch: Record<string, unknown> = {};
  if (body.conteudo && typeof body.conteudo === "object") patch.conteudo = body.conteudo;
  if (typeof body.ativo === "boolean") patch.ativo = body.ativo;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nada para atualizar" }, { status: 400 });
  }

  const supabase = await createClient();
  const { error } = await supabase.from("pagina_blocos").update(patch).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await autorizarPagina();
  if ("erro" in auth) return auth.erro;
  const { id } = await params;

  const supabase = await createClient();
  // Os cliques ficam (pagina_cliques.bloco_id vira null): apagar um botão não
  // deve apagar o histórico de quantas pessoas clicaram nele.
  const { error } = await supabase.from("pagina_blocos").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
