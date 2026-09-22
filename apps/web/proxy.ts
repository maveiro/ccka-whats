import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** Host de uma URL de configuração; null quando a variável não está posta. */
function hostDe(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    // Variável mal formada não pode derrubar TODA requisição do app: sem
    // host reconhecido, o redirecionamento simplesmente não acontece.
    return null;
  }
}

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Refresh de sessão — obrigatório para que getUser() funcione em Server Components
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // Dois hosts, dois papéis (21/09/2026). `link.plauz.com.br` é o que o fã
  // abre — página do artista, landing, redirect de clique; o painel vive em
  // `whats.plauz.com.br`. Não é estética: cookie é por host, e sessão de
  // admin não precisa existir no endereço que milhares de desconhecidos
  // abrem. Com os dois separados, qualquer falha futura numa página pública
  // não tem uma sessão de admin ao alcance.
  //
  // Só o caminho de ENTRADA é redirecionado (/dashboard e /login). O
  // contrário — página pública aberta pelo host do painel — continua
  // funcionando: quebrar um link já copiado seria pior que servir a mesma
  // página por dois endereços. `/auth/` fica fora de propósito: é o retorno
  // do OAuth, amarrado ao host que iniciou o fluxo.
  const hostAtual = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const hostPublico = hostDe(process.env.NEXT_PUBLIC_LINK_BASE_URL);
  const basePainel = process.env.NEXT_PUBLIC_PANEL_BASE_URL;

  if (
    basePainel && hostPublico && hostAtual === hostPublico &&
    (pathname === "/login" || pathname.startsWith("/dashboard"))
  ) {
    const destino = new URL(pathname + request.nextUrl.search, basePainel);
    return NextResponse.redirect(destino);
  }

  // Rotas sempre públicas — sem proteção de auth
  // "/f/" é a página pública de formulário de cadastro: é embutida por iframe
  // em sites de terceiros e, por definição, não tem sessão de usuário.
  // "/c/" é o redirect rastreado do botão de campanha: quem abre é um cliente
  // com o link que recebeu no WhatsApp, também sem sessão.
  // "/a/" é a página pública do artista (a que substitui o Linktree) e "/l/" o
  // redirect rastreado dos botões dela — é o endereço que vai em story e em
  // bio de Instagram, então é o caminho MAIS público do app.
  const publicPaths = ["/register", "/forgot-password", "/reset-password", "/auth/", "/api/", "/f/", "/c/", "/a/", "/l/"];
  if (publicPaths.some((p) => pathname.startsWith(p))) {
    return supabaseResponse;
  }

  // Protege apenas /dashboard/** — redireciona para login se não autenticado
  if (!user && pathname.startsWith("/dashboard")) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Usuário autenticado na página de login → redireciona para dashboard
  if (user && pathname === "/login") {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
