import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { autorizarPagina } from "@/lib/paginas-auth";

// Métricas de uma página. A agregação é no banco (metricas_pagina): contar
// dezenas de milhares de cliques no Node é o erro que o Analytics de
// mensagens já paga com scan paginado.

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await autorizarPagina();
  if ("erro" in auth) return auth.erro;
  const { id } = await params;

  const dias = Math.min(Math.max(Number(req.nextUrl.searchParams.get("dias") ?? 30) || 30, 1), 365);

  // Client autenticado: a função confere my_tenant_id() internamente, e é
  // esse client que carrega a identidade de quem pergunta.
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("metricas_pagina", { p_pagina_id: id, p_dias: dias });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Página não encontrada" }, { status: 404 });
  return NextResponse.json(data);
}
