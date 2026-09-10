import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

// Redirect rastreado do botão de URL de um template de campanha.
//
// O template aponta para /c/{{1}} e o campaign-sender manda o click_token do
// destinatário como sufixo da URL, então cada pessoa recebe um link único.
// Aqui registramos o clique e mandamos ela para o destino real da campanha.
//
// Fora do /dashboard de propósito — quem abre isto é um cliente, sem sessão.
// Mesma natureza da página pública de formulário em /f/[slug]; ambas estão em
// publicPaths no proxy.ts.
//
// GET em Route Handler já é dinâmico por padrão desde a 15.0, então isto é
// redundante hoje — fica explícito para que ninguém "otimize" a rota para
// estática depois: servida do cache, ela pararia de contar cliques sem dar
// erro nenhum. Quem realmente protege do cache de borda é o Cache-Control
// no-store de redirect() abaixo.
export const dynamic = "force-dynamic";

// Buscadores de preview e ferramentas de linha de comando não são cliques de
// gente. Lista deliberadamente conservadora: um falso positivo aqui descarta
// silenciosamente a compra de um cliente real, que é muito pior do que contar
// um acesso a mais. Por isso NÃO casamos "WhatsApp" solto — o navegador
// embutido do app pode carregar esse nome no user-agent, e derrubar esses
// acessos zeraria justamente os cliques que interessam. Só a forma
// "WhatsApp/2.x", que é o buscador de preview.
//
// Na prática o risco é pequeno: URL de botão CTA não gera cartão de preview,
// então o buscador do WhatsApp nem chega aqui. O filtro existe para links
// reencaminhados por quem recebeu (colar em outro app gera preview lá).
const CRAWLER_UA =
  /facebookexternalhit|Facebot|WhatsApp\/|Slackbot|Twitterbot|LinkedInBot|TelegramBot|Discordbot|Googlebot|bingbot|Applebot|curl\/|Wget\/|python-requests|HeadlessChrome/i;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const home = new URL("/", req.url).toString();

  // Um clique que não é registrado é um dado perdido. Um comprador que vê
  // tela de erro é uma venda perdida. Toda falha daqui para baixo cai no
  // redirect assim mesmo — nunca em 404, nunca em 500.
  try {
    if (CRAWLER_UA.test(req.headers.get("user-agent") ?? "")) {
      // Sem destino resolvido ainda: manda para a home, sem contar o acesso.
      return redirect(home);
    }

    const admin = createAdminClient();
    const { data, error } = await admin.rpc("register_campaign_click", { p_token: token });

    if (error) {
      await admin.from("events_log").insert({
        tenant_id: null,
        session_id: null,
        event_type: "error",
        payload: { token },
        error: `register_campaign_click: ${error.message}`,
      });
      return redirect(home);
    }

    // Token inexistente (link adulterado, campanha excluída) ou campanha sem
    // destino configurado. Não é erro do cliente — leva para a home.
    if (typeof data !== "string" || !isSafeHttpUrl(data)) return redirect(home);

    return redirect(data);
  } catch {
    return redirect(home);
  }
}

function redirect(url: string): NextResponse {
  const res = NextResponse.redirect(url, 302);
  // Sem isto, uma camada de cache pode responder o 302 no lugar do handler e
  // os cliques seguintes somem.
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}

// O destino é configurado por admin, não vem do cliente — mas um valor
// malformado no banco derrubaria o redirect para todo mundo da campanha, e
// um esquema como javascript: transformaria o nosso link num vetor de ataque.
function isSafeHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}
