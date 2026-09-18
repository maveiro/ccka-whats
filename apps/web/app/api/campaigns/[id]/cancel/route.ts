import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Cancelar campanha: encerra e marca como `cancelled` quem ainda não recebeu.
//
// Não apaga nada — a campanha já disparou para parte da base, e esse
// histórico (com o custo no ledger) é o que explica a fatura. Apagar é o
// "Excluir", que só existe para rascunho.
//
// Client autenticado: a função confere `my_tenant_id()` internamente, e é
// este client que carrega a identidade de quem pede.

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: operator } = await supabase
    .from("operators").select("role").eq("id", user.id).single<{ role: string }>();
  if (operator?.role !== "admin") {
    return NextResponse.json({ error: "Só admin pode cancelar uma campanha" }, { status: 403 });
  }

  const { data, error } = await supabase.rpc("cancelar_campanha", { p_campaign_id: id });

  if (error) {
    // A função levanta exceção com motivo legível ("campanha com status
    // completed não pode ser cancelada") — repassar é melhor que um 500 mudo.
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json(data);
}
