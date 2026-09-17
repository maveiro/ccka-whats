import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

// Redirect rastreado dos botões da página pública (/a/[slug]).
//
// Mesma natureza do /c/[token] das campanhas, e as mesmas duas regras que
// custaram caro lá:
//
//  - NUNCA devolver erro: quem está do outro lado é alguém indo comprar
//    ingresso. Bloco inexistente, RPC falhando, destino vazio — tudo cai em
//    redirect para a página (ou para a home). Clique perdido é um dado;
//    comprador vendo erro é uma venda.
//  - `force-dynamic` + `no-store`: servida do cache, a rota pararia de contar
//    clique sem dar erro nenhum.
export const dynamic = "force-dynamic";

// Buscadores de preview não são gente clicando. Lista conservadora de
// propósito: falso positivo aqui descarta a compra de alguém real. Diferente
// do /c/, aqui o preview ACONTECE (a página é compartilhada em story e em
// bio), então o filtro é o que separa "10 mil cliques" de "10 mil previews".
const CRAWLER_UA =
  /facebookexternalhit|Facebot|WhatsApp\/|Slackbot|Twitterbot|LinkedInBot|TelegramBot|Discordbot|Googlebot|bingbot|Applebot|curl\/|Wget\/|python-requests|HeadlessChrome/i;

export async function GET(req: NextRequest, { params }: { params: Promise<{ bloco: string }> }) {
  const { bloco } = await params;
  const home = new URL("/", req.url).toString();
  const showId = req.nextUrl.searchParams.get("s");

  const responder = (destino: string) =>
    NextResponse.redirect(destino, { headers: { "Cache-Control": "no-store" } });

  try {
    const admin = createAdminClient();

    // Preview: resolve o destino sem contar clique. Se nem destino houver,
    // vai para a home — o preview não pode ficar pendurado.
    if (CRAWLER_UA.test(req.headers.get("user-agent") ?? "")) {
      const { data } = await admin
        .from("pagina_blocos")
        .select("conteudo")
        .eq("id", bloco)
        .maybeSingle<{ conteudo: Record<string, unknown> }>();
      const url = typeof data?.conteudo?.url === "string" ? data.conteudo.url : null;
      return responder(url ?? home);
    }

    const { data: destino, error } = await admin.rpc("registrar_clique_pagina", {
      p_bloco_id: bloco,
      p_show_id: showId,
    });

    if (error || typeof destino !== "string" || !destino) return responder(home);
    return responder(destino);
  } catch {
    return responder(home);
  }
}
