import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { autorizarPagina } from "@/lib/paginas-auth";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await autorizarPagina();
  if ("erro" in auth) return auth.erro;
  const { id } = await params;

  const body = await req.json() as Record<string, unknown>;
  const patch: Record<string, unknown> = {};

  for (const [campo, coluna] of [
    ["titulo", "titulo"],
    ["bio", "bio"],
    ["artista", "artista"],
    ["avatarPath", "avatar_path"],
  ] as const) {
    if (typeof body[campo] === "string") {
      patch[coluna] = (body[campo] as string).trim() || null;
    }
  }
  if (typeof body.ativo === "boolean") patch.ativo = body.ativo;
  // O tema desce como veio e é validado na LEITURA (lib/pagina-tema.ts), não
  // aqui: a página pública é quem não pode quebrar com cor inválida, e
  // validar só na escrita deixaria o valor antigo do banco sem checagem.
  if (body.tema && typeof body.tema === "object") patch.tema = body.tema;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nada para atualizar" }, { status: 400 });
  }

  const supabase = await createClient();
  const { error } = await supabase.from("paginas_publicas").update(patch).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await autorizarPagina();
  if ("erro" in auth) return auth.erro;
  if (auth.role !== "admin") {
    return NextResponse.json({ error: "Só admin pode remover uma página" }, { status: 403 });
  }
  const { id } = await params;

  const supabase = await createClient();
  const { error } = await supabase.from("paginas_publicas").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
