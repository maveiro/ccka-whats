import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/server";
import { lerTema, RAIO_DO_ESTILO } from "@/lib/pagina-tema";
import { env } from "@/lib/env";

// Página pública do artista — a que substitui o Linktree.
//
// Fora do /dashboard de propósito (não passa pelo proxy de auth, não carrega
// o layout do painel), mesmo desenho de /f/[slug]. A leitura é por service
// role e seleciona só o que é público: nada de tenant_id, nada de contagem.
//
// Os botões de show NÃO são cadastrados: saem de agenda_shows_sync, que vem
// do board do Monday. É o ponto inteiro desta página — no Linktree eram ~25
// botões mantidos à mão, com "Esgotou!" editado por alguém.
//
// `revalidate` em vez de dinâmico: a agenda muda algumas vezes por dia e a
// página é o que o público abre em massa depois de um story. 60s deixa o CDN
// absorver a carga e ainda reflete uma mudança de agenda rápido.
export const revalidate = 60;

const BUCKET = `${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public`;

interface Bloco {
  id: string;
  tipo: "texto" | "link" | "imagem" | "agenda";
  conteudo: Record<string, unknown>;
}

interface Show {
  id: string;
  cidade: string | null;
  teatro: string | null;
  data_show: string | null;
  status_venda: string | null;
  espetaculo: string | null;
  link_compra: string | null;
}

async function carregar(slug: string) {
  const admin = createAdminClient();

  const { data: pagina } = await admin
    .from("paginas_publicas")
    .select("id, slug, artista, titulo, bio, avatar_path, tema, ativo, tenant_id")
    .eq("slug", slug)
    .maybeSingle();

  if (!pagina || !pagina.ativo) return null;

  const { data: blocos } = await admin
    .from("pagina_blocos")
    .select("id, tipo, conteudo")
    .eq("pagina_id", pagina.id)
    .eq("ativo", true)
    .order("ordem", { ascending: true });

  const precisaAgenda = (blocos ?? []).some((b) => b.tipo === "agenda");
  let shows: Show[] = [];

  if (precisaAgenda && pagina.artista) {
    // Mesmas regras da lista do fã no WhatsApp: publicado, do artista, e só
    // o que ainda não aconteceu. Um show que saiu do ar na central também
    // sai daqui — é a mesma curadoria, não duas.
    const { data } = await admin
      .from("agenda_shows_sync")
      .select("id, cidade, teatro, data_show, status_venda, espetaculo, link_compra")
      .eq("tenant_id", pagina.tenant_id)
      .eq("artista", pagina.artista)
      .eq("publicado", true)
      .gte("data_show", new Date().toISOString())
      .order("data_show", { ascending: true });
    shows = (data ?? []) as Show[];
  }

  // Arte por espetáculo, para o bloco de agenda usar como imagem do grupo.
  const { data: temas } = await admin
    .from("agenda_temas")
    .select("nome, nome_chave")
    .eq("tenant_id", pagina.tenant_id);

  return { pagina, blocos: (blocos ?? []) as Bloco[], shows, temas: temas ?? [] };
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const dados = await carregar(slug);
  if (!dados) return { title: "Página não encontrada" };

  const { pagina } = dados;
  return {
    title: pagina.titulo,
    description: pagina.bio ?? undefined,
    openGraph: {
      title: pagina.titulo,
      description: pagina.bio ?? undefined,
      images: pagina.avatar_path ? [`${BUCKET}/paginas/${pagina.avatar_path}`] : undefined,
    },
  };
}

function chave(t: string): string {
  return t.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
}

/** "20 SET · QUI" — formato curto, que é o que cabe num botão no celular. */
function dataCurta(iso: string): string {
  const d = new Date(iso);
  const dia = d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit" });
  const mes = d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", month: "short" })
    .replace(".", "").toUpperCase();
  return `${dia} ${mes}`;
}

export default async function PaginaPublica({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const dados = await carregar(slug);
  if (!dados) notFound();

  const { pagina, blocos, shows } = dados;
  const tema = lerTema(pagina.tema);
  const raio = RAIO_DO_ESTILO[tema.estilo_botao];

  const estiloBotao = {
    background: tema.cor_botao,
    color: tema.cor_texto_botao,
    borderRadius: raio,
  };

  return (
    <main
      style={{
        background: tema.imagem_fundo_path
          ? `linear-gradient(rgba(0,0,0,.55), rgba(0,0,0,.75)), url(${BUCKET}/paginas/${tema.imagem_fundo_path}) center/cover fixed`
          : tema.cor_fundo,
        color: tema.cor_texto,
        minHeight: "100vh",
      }}
    >
      <div className="mx-auto w-full max-w-lg px-5 py-10 space-y-6">
        <header className="text-center space-y-3">
          {pagina.avatar_path && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`${BUCKET}/paginas/${pagina.avatar_path}`}
              alt={pagina.titulo}
              className="mx-auto h-24 w-24 rounded-full object-cover"
            />
          )}
          <h1 className="text-xl font-semibold">{pagina.titulo}</h1>
          {pagina.bio && <p className="text-sm opacity-80 whitespace-pre-line">{pagina.bio}</p>}
        </header>

        {blocos.map((bloco) => {
          if (bloco.tipo === "texto") {
            const titulo = typeof bloco.conteudo.titulo === "string" ? bloco.conteudo.titulo : null;
            const texto = typeof bloco.conteudo.texto === "string" ? bloco.conteudo.texto : null;
            return (
              <section key={bloco.id} className="space-y-1 text-center">
                {titulo && <h2 className="text-sm font-semibold tracking-wide uppercase opacity-90">{titulo}</h2>}
                {texto && <p className="text-sm opacity-80 whitespace-pre-line">{texto}</p>}
              </section>
            );
          }

          if (bloco.tipo === "imagem") {
            const path = typeof bloco.conteudo.imagem_path === "string" ? bloco.conteudo.imagem_path : null;
            if (!path) return null;
            const alt = typeof bloco.conteudo.alt === "string" ? bloco.conteudo.alt : "";
            return (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={bloco.id} src={`${BUCKET}/paginas/${path}`} alt={alt} style={{ borderRadius: raio }} className="w-full" />
            );
          }

          if (bloco.tipo === "link") {
            const rotulo = typeof bloco.conteudo.rotulo === "string" ? bloco.conteudo.rotulo : "Abrir";
            const path = typeof bloco.conteudo.imagem_path === "string" ? bloco.conteudo.imagem_path : null;
            return (
              <a
                key={bloco.id}
                // Passa pelo /l/ para contar o clique. `rel` fecha a porta do
                // window.opener e não manda nosso endereço para o destino.
                href={`/l/${bloco.id}`}
                rel="noopener noreferrer nofollow"
                style={estiloBotao}
                className="block overflow-hidden transition-transform active:scale-[.99]"
              >
                {path && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`${BUCKET}/paginas/${path}`} alt="" className="w-full" />
                )}
                <span className="block px-4 py-4 text-center text-sm font-medium">{rotulo}</span>
              </a>
            );
          }

          // agenda
          const filtro = typeof bloco.conteudo.espetaculo === "string" ? bloco.conteudo.espetaculo : null;
          const titulo = typeof bloco.conteudo.titulo === "string" ? bloco.conteudo.titulo : null;
          const doBloco = filtro
            ? shows.filter((s) => s.espetaculo && chave(s.espetaculo) === chave(filtro))
            : shows;

          if (doBloco.length === 0) return null;

          return (
            <section key={bloco.id} className="space-y-3">
              {titulo && <h2 className="text-sm font-semibold tracking-wide uppercase text-center opacity-90">{titulo}</h2>}
              <div className="space-y-2">
                {doBloco.map((show) => {
                  const esgotado = (show.status_venda ?? "").toLowerCase().includes("esgotad");
                  return (
                    <a
                      key={show.id}
                      href={`/l/${bloco.id}?s=${show.id}`}
                      rel="noopener noreferrer nofollow"
                      style={{ ...estiloBotao, opacity: esgotado ? 0.6 : 1 }}
                      className="flex items-center justify-between gap-3 px-4 py-3 transition-transform active:scale-[.99]"
                    >
                      <span className="min-w-0">
                        <span className="block text-sm font-medium truncate">{show.cidade ?? "Show"}</span>
                        {show.teatro && <span className="block text-xs opacity-70 truncate">{show.teatro}</span>}
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block text-sm font-semibold">{show.data_show ? dataCurta(show.data_show) : ""}</span>
                        {/* O status vem do board: "Esgotou!" deixa de ser
                            rótulo editado à mão. */}
                        {show.status_venda && (
                          <span className="block text-[11px] uppercase opacity-70">{show.status_venda}</span>
                        )}
                      </span>
                    </a>
                  );
                })}
              </div>
            </section>
          );
        })}

        <footer className="pt-4 text-center text-[11px] opacity-40">
          agenda atualizada automaticamente
        </footer>
      </div>
    </main>
  );
}
