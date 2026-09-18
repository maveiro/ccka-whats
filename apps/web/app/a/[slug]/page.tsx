import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/server";
import { lerTema, RAIO_DO_ESTILO } from "@/lib/pagina-tema";
import { env } from "@/lib/env";
import RegistraVisita from "./registra-visita";
import { acaoDoShow, dataDoCard, selosDoShow } from "@/lib/show-card";

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
  label_ingressos: string | null;
  label_periodo: string | null;
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
      .select("id, cidade, teatro, data_show, status_venda, espetaculo, link_compra, label_ingressos, label_periodo")
      .eq("tenant_id", pagina.tenant_id)
      .eq("artista", pagina.artista)
      .eq("publicado", true)
      .gte("data_show", new Date().toISOString())
      .order("data_show", { ascending: true });
    shows = (data ?? []) as Show[];
  }

  // Arte por espetáculo: o bloco de agenda mostra a arte UMA VEZ, no topo do
  // grupo. Ela pertence ao espetáculo, não à data — repetir a mesma imagem em
  // 12 cards seria ruído, e o bloco de data é o que a pessoa varre com o olho.
  const { data: temas } = await admin
    .from("agenda_temas")
    .select("nome, nome_chave, imagem_path")
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

export default async function PaginaPublica({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const dados = await carregar(slug);
  if (!dados) notFound();

  const { pagina, blocos, shows, temas } = dados;
  const tema = lerTema(pagina.tema);
  // Um único instante para todo o render: chamar o relógio por card faria
  // dois shows da mesma página calcularem "hoje" em momentos diferentes.
  const agora = new Date();
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
      <RegistraVisita slug={pagina.slug} />
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
          const urlListaEspera = typeof bloco.conteudo.url_lista_espera === "string"
            ? bloco.conteudo.url_lista_espera
            : null;
          const doBloco = filtro
            ? shows.filter((s) => s.espetaculo && chave(s.espetaculo) === chave(filtro))
            : shows;

          if (doBloco.length === 0) return null;

          // Arte do espetáculo filtrado. Só quando o bloco tem filtro: um
          // bloco "todos os shows" mistura espetáculos e não teria arte única.
          const temaDoBloco = filtro
            ? temas.find((t) => t.nome_chave === chave(filtro))
            : null;
          const mostrarArte = bloco.conteudo.mostrar_arte !== false;
          const arte = mostrarArte && temaDoBloco?.imagem_path
            ? `${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/render/image/public/temas/${temaDoBloco.imagem_path}?width=1080&resize=contain&quality=75`
            : null;

          return (
            <section key={bloco.id} className="space-y-3">
              {arte && (
                // Servida pela transformação do Storage (CDN): a original tem
                // tamanho de impressão, e mandá-la crua custaria o carregamento
                // da página inteira.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={arte} alt={temaDoBloco?.nome ?? ""} style={{ borderRadius: raio }} className="w-full" />
              )}
              {titulo && <h2 className="text-sm font-semibold tracking-wide uppercase text-center opacity-90">{titulo}</h2>}
              <div className="space-y-2">
                {doBloco.map((show) => {
                  const data = dataDoCard(show.data_show);
                  const selos = selosDoShow(show, agora);
                  const acao = acaoDoShow(show, urlListaEspera);
                  const apagado = acao.tipo === "esgotado" || acao.tipo === "sem_acao";

                  // O card inteiro é clicável quando há ação — num celular,
                  // exigir acerto no botão pequeno perde toque.
                  const conteudoCard = (
                    <>
                      {/* Bloco de data, como na referência: mês, dia e dia da
                          semana, que é o que a pessoa procura primeiro. */}
                      <span
                        className="shrink-0 w-14 text-center rounded-lg py-1.5"
                        style={{ background: `${tema.cor_texto}14` }}
                      >
                        <span className="block text-[10px] uppercase opacity-70">{data?.mes ?? ""}</span>
                        <span className="block text-xl font-semibold leading-tight">{data?.dia ?? "—"}</span>
                        <span className="block text-[10px] uppercase opacity-70">{data?.semana ?? ""}</span>
                      </span>

                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold truncate">{show.cidade ?? "Show"}</span>
                        <span className="block text-xs opacity-70 truncate">
                          {[data?.hora, show.teatro].filter(Boolean).join(" · ")}
                        </span>
                        {selos.length > 0 && (
                          <span className="mt-1.5 flex flex-wrap gap-1">
                            {selos.map((selo) => (
                              <span
                                key={selo}
                                className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded"
                                style={{ background: `${tema.cor_texto}1f` }}
                              >
                                {selo}
                              </span>
                            ))}
                          </span>
                        )}
                      </span>

                      {acao.tipo !== "sem_acao" && (
                        <span
                          className="shrink-0 text-xs font-medium px-3 py-2 rounded-lg border"
                          style={{
                            borderColor: `${tema.cor_texto_botao}59`,
                            // Esgotado não convida ao clique: fica com a cara
                            // de estado, não de ação.
                            background: acao.tipo === "esgotado" ? "transparent" : tema.cor_texto_botao,
                            color: acao.tipo === "esgotado" ? tema.cor_texto_botao : tema.cor_botao,
                          }}
                        >
                          {acao.rotulo}
                        </span>
                      )}
                    </>
                  );

                  const estilo = { ...estiloBotao, opacity: apagado ? 0.65 : 1 };
                  const classes = "flex items-center gap-3 px-3 py-3 transition-transform";

                  return acao.tipo === "ingressos" || acao.tipo === "lista_espera" ? (
                    <a
                      key={show.id}
                      href={`/l/${bloco.id}?s=${show.id}`}
                      rel="noopener noreferrer nofollow"
                      style={estilo}
                      className={`${classes} active:scale-[.99]`}
                    >
                      {conteudoCard}
                    </a>
                  ) : (
                    // Sem ação, não é link: o card mostra o estado (esgotado,
                    // ou confirmado sem onde captar) e não finge ser clicável.
                    <div key={show.id} style={estilo} className={classes}>
                      {conteudoCard}
                    </div>
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
