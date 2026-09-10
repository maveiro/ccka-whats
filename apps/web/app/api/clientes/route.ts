import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Busca de cliente por telefone — admin-only, como toda leitura de `clientes`
// (decisão fechada do PRD: operator não tem listagem geral, para não expor
// nome/e-mail de fãs de um artista a quem só deveria ver outro número).
//
// Deliberadamente NÃO existe listagem sem filtro: o caso de uso é atender um
// pedido de exclusão de dados, que sempre parte de um telefone conhecido.
// Listar a base inteira numa tela seria expor PII sem necessidade.

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: operator } = await supabase
    .from("operators")
    .select("role")
    .eq("id", user.id)
    .single<{ role: string }>();

  if (operator?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const telefone = (new URL(req.url).searchParams.get("telefone") ?? "").replace(/\D/g, "");
  if (telefone.length < 8) {
    return NextResponse.json({ error: "Informe ao menos 8 dígitos do telefone" }, { status: 400 });
  }

  // Busca pela CHAVE do telefone (migration 0037): "(41) 99883-9193",
  // "41998839193" e "554198839193" são a mesma pessoa. Um `like` no telefone
  // não encontrava quem o WhatsApp guardou sem o nono dígito — foi assim que
  // o bug apareceu, com um cliente existente dando "nenhum resultado".
  //
  // Os 8 últimos dígitos são o que a chave preserva de qualquer formato, então
  // é por eles que se procura. A RLS limita ao tenant do operador.
  const { data, error } = await supabase
    .from("clientes")
    .select("id, nome, email, telefone, origem, cadastro_completo, pulou_cadastro, pii_apagada_em, created_at")
    .like("telefone_chave", `%${telefone.slice(-8)}`)
    .is("deleted_at", null)
    .limit(20);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}
