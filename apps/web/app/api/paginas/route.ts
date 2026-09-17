import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { autorizarPagina } from "@/lib/paginas-auth";

// Páginas públicas do artista (a que substitui o Linktree).
// RLS filtra por tenant (regra 15) — o client autenticado basta.

export async function GET() {
  const auth = await autorizarPagina();
  if ("erro" in auth) return auth.erro;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("paginas_publicas")
    .select("id, slug, artista, titulo, bio, avatar_path, tema, ativo, updated_at")
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const auth = await autorizarPagina();
  if ("erro" in auth) return auth.erro;

  const body = await req.json() as Record<string, unknown>;
  const slug = typeof body.slug === "string" ? body.slug.trim().toLowerCase() : "";
  const titulo = typeof body.titulo === "string" ? body.titulo.trim() : "";

  // Mesmo formato que o banco exige — barrar aqui é o que dá mensagem
  // acionável em vez de erro de constraint.
  if (!/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(slug)) {
    return NextResponse.json(
      { error: "O endereço deve ter de 3 a 50 caracteres, só minúsculas, números e hífen" },
      { status: 400 },
    );
  }
  if (!titulo) return NextResponse.json({ error: "Título é obrigatório" }, { status: 400 });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("paginas_publicas")
    .insert({
      tenant_id: auth.tenantId,
      slug,
      titulo,
      artista: typeof body.artista === "string" && body.artista.trim() ? body.artista.trim() : null,
      bio: typeof body.bio === "string" && body.bio.trim() ? body.bio.trim() : null,
    })
    .select("id, slug")
    .single();

  if (error) {
    // slug é único GLOBALMENTE: é uma URL pública, e o conflito pode ser com
    // a página de outro tenant — a mensagem não revela de quem.
    const conflito = error.code === "23505";
    return NextResponse.json(
      { error: conflito ? "Este endereço já está em uso" : error.message },
      { status: conflito ? 409 : 500 },
    );
  }
  return NextResponse.json(data, { status: 201 });
}
