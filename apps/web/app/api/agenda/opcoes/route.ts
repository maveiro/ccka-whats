import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getConexao, buscarOpcoes } from "@/lib/agenda-painel";

// Opções de filtro vindas do painel-shows, para a tela de agenda oferecer
// dropdown em vez de campo livre. Passa pelo servidor porque o token da
// conexão é deny-all e não pode chegar ao browser.

export async function GET() {
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

  const conexao = await getConexao(operator.tenant_id);
  if (!conexao || !conexao.ativo) {
    return NextResponse.json({ error: "Conexão com o painel-shows não configurada" }, { status: 409 });
  }

  try {
    return NextResponse.json(await buscarOpcoes(conexao));
  } catch (err) {
    // A tela mostra o motivo: sem isso, "o dropdown está vazio" é
    // indistinguível de "o board não tem nada".
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
