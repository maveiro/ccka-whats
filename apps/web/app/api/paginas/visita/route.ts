import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

// Registro de visualização da página pública.
//
// PÚBLICA e sem auth: quem chama é o navegador de quem abriu /a/{slug}.
//
// Por que um beacon do navegador, e não contagem no servidor: a página tem
// `revalidate = 60` (é o que aguenta tráfego de story), então o componente não
// roda por visita — contar lá contaria uma vez por minuto. E o beacon exclui
// robô de graça: buscador de preview não executa JavaScript, então o número
// não infla com os previews de WhatsApp e Instagram, que é justamente onde o
// link mais circula.
//
// O que ele NÃO faz: identificar visitante. Sem cookie, sem IP, sem
// user-agent. O número é de aberturas, não de pessoas únicas — e é uma
// escolha, não limitação (ver regra 41).
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { slug?: unknown };
  const slug = typeof body.slug === "string" ? body.slug.trim().toLowerCase() : "";

  // 204 mesmo quando não conta: é telemetria de uma página pública, e
  // devolver erro aqui só geraria ruído no console de quem está lendo.
  if (!slug) return new NextResponse(null, { status: 204 });

  try {
    await createAdminClient().rpc("registrar_visita_pagina", { p_slug: slug });
  } catch {
    // Visita perdida é um dado; página quebrada é uma venda.
  }

  return new NextResponse(null, { status: 204 });
}
