import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Publicar/despublicar vários shows de uma vez.
//
// Existe porque show novo do board chega despublicado (migration
// agenda_chega_despublicado): uma rodada pode trazer dez datas, e aprovar uma
// por uma em dez requests é o tipo de atrito que faz a fila ser ignorada — e
// fila ignorada, aqui, é agenda que o fã não vê.
//
// Autorização é da RLS (migration 0025: escrita para admin e operator).

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json() as { ids?: unknown; publicado?: unknown };
  const ids = Array.isArray(body.ids) ? body.ids.filter((i): i is string => typeof i === "string") : [];
  const publicado = body.publicado !== false; // default: publicar

  if (ids.length === 0) {
    return NextResponse.json({ error: "Nenhum show informado" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("agenda_shows_sync")
    .update({ publicado, updated_at: new Date().toISOString() })
    .in("id", ids)
    .select("id");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ alterados: data?.length ?? 0, publicado });
}
