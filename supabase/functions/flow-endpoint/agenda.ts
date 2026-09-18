// Telas do Flow `agenda_shows` (Sprint B2).
//
// Contrato com o JSON do Flow publicado no WhatsApp Manager — os nomes de tela
// e as chaves de `data` aqui têm que casar com o que está lá. A referência
// versionada é docs/flows/agenda_shows.flow.json; mudar um lado sem o outro
// resulta em Flow que abre e não mostra nada.
//
// Regra que não pode ser esquecida: este módulo NUNCA chama painel-shows,
// monday ou Sympla. Lê só a cópia local (agenda_shows_sync), porque o endpoint
// do Flow tem teto de latência do cliente do WhatsApp — depender de terceiros
// aqui quebraria isso (decisão registrada no PRD).

export const TELA_AGENDA = "AGENDA";
export const TELA_DETALHE = "DETALHE";

// Telas do Flow paralelo em avaliação (18/09/2026): mesmo conteúdo, mas a
// lista é um `Dropdown` (200 opções) em vez de `RadioButtonsGroup` (20). Vive
// num Flow SEPARADO de propósito — trocar o componente do Flow em produção
// exigiria republicar e descontinuar o atual, e a comparação lado a lado é
// justamente o que decide se vale pagar isso.
export const TELA_AGENDA_LONGA = "AGENDA_LONGA";
export const TELA_DETALHE_LONGO = "DETALHE_LONGO";

// Teto do Dropdown: a doc da Meta permite 200 (100 com imagem). 100 é folga
// suficiente para uma turnê inteira e mantém o payload pequeno.
export const MAX_ITENS_DROPDOWN = 100;

// Teto de itens da lista: 20 é limite DURO do componente `RadioButtonsGroup`
// ("Max # of options: 20", doc da Meta), não escolha nossa — subir o número
// não mostra mais shows, quebra a tela. Em 18/09/2026 a turnê do IB passou
// disso: 26 datas publicadas, e o fã via até Maceió (a vigésima), sem nenhum
// sinal de que havia mais seis.
//
// Por isso a lista PAGINA: uma das 20 vagas vira o item de navegação, e o
// resto dos shows chega no lote seguinte. Quem escolhe qual tela responder é
// este endpoint, não o JSON publicado — então paginar não exige Flow novo,
// nem descontinuar o atual, nem invalidar template aprovado.
const MAX_ITENS = 20;
const POR_PAGINA = MAX_ITENS - 1;

// Prefixo do item de navegação. Vai no mesmo campo `id` que carrega o uuid do
// show, então precisa ser impossível de confundir com um: uuid não tem ":".
export const PREFIXO_PAGINA = "pagina:";

// Limites do item de lista do Flow (doc da Meta): title 30, description 300.
// O title de 30 NÃO era respeitado: `cidade · teatro` passava de 30 em 17 dos
// 26 shows do IB (achado em 18/09/2026), então o fã via nome cortado no meio
// — "Foz do Iguaçu/PR · Rafain Pala...". Por isso o título passou a ser só a
// cidade (o maior caso real, "São José dos Campos/SP", tem 22) e o teatro
// desceu para a descrição, que tem folga de sobra.
const MAX_TITULO = 30;
const MAX_DESCRICAO = 300;

export interface ShowRow {
  id: string;
  artista: string;
  cidade: string | null;
  teatro: string | null;
  data_show: string | null;
  status_venda: string | null;
  link_compra: string | null;
  espetaculo?: string | null;
  label_ingressos?: string | null;
  label_periodo?: string | null;
}

/** Conteúdo do espetáculo (agenda_temas), quando o show casa com um. */
export interface TemaRow {
  nome: string;
  sinopse: string | null;
  imagem_base64: string | null;
  imagem_largura?: number | null;
  imagem_altura?: number | null;
}

interface ItemLista {
  id: string;
  title: string;
  description: string;
}

function formatarData(iso: string | null): string {
  if (!iso) return "data a confirmar";

  const data = new Date(iso);
  // pt-BR com fuso de São Paulo: o servidor roda em UTC, e sem isso um show às
  // 21h aparece como 00h do dia seguinte.
  const dia = data.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
  });
  const hora = data.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
  });

  // Meia-noite exata em São Paulo significa "só a data" — é o que o
  // agenda-sync grava quando o painel-shows não sabe a hora do show (ver
  // resolverQuando em agenda-sync). Mostrar "00:00" faria o fã ler
  // meia-noite para um show de noite; nesta operação os horários reais vão
  // de 16h30 a 22h30, então show à meia-noite não existe.
  return hora === "00:00" ? `${dia} · hora a confirmar` : `${dia} ${hora}`;
}

/**
 * Item da lista de shows.
 *
 * `title` = cidade, `description` = data · teatro · status · selos. Os selos
 * (`label_ingressos` e `label_periodo`, vindos do board) entram na DESCRIÇÃO
 * de propósito: o Flow tem um campo `metadata` feito para isso, mas usá-lo
 * exigiria declarar propriedade nova na tela — e Flow publicado é imutável,
 * ou seja, Flow novo, descontinuar o antigo e invalidar qualquer template
 * aprovado que aponte para o id velho. Na descrição, o mesmo dado chega hoje,
 * sem fila.
 */
function itemDoShow(s: ShowRow): ItemLista {
  return {
    id: s.id,
    title: (s.cidade ?? "Show").slice(0, MAX_TITULO),
    description: [
      formatarData(s.data_show),
      s.teatro,
      s.status_venda,
      s.label_periodo,
      s.label_ingressos,
    ].filter(Boolean).join(" · ").slice(0, MAX_DESCRICAO),
  };
}

/**
 * Lê o destino de um item de navegação. Devolve null para id de show — é o
 * que separa "o fã quer ver um show" de "o fã quer a próxima página".
 */
export function paginaDoItem(id: string | null | undefined): number | null {
  if (!id || !id.startsWith(PREFIXO_PAGINA)) return null;
  const n = Number.parseInt(id.slice(PREFIXO_PAGINA.length), 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Uma página da lista, com os itens de navegação que couberem.
 *
 * A ordem importa: "voltar" primeiro e "ver mais" por último, porque é a
 * ordem em que a pessoa lê. E os dois só existem quando há para onde ir —
 * item de navegação que não navega é vaga de show desperdiçada.
 */
export function montarLista(shows: ShowRow[], offset = 0, maxItens = MAX_ITENS): ItemLista[] {
  const inicio = Math.max(0, Math.min(offset, shows.length));
  const voltar = inicio > 0;
  const cabem = maxItens - 1 - (voltar ? 1 : 0);
  const pagina = shows.slice(inicio, inicio + cabem);
  const restantes = shows.length - (inicio + pagina.length);

  const itens: ItemLista[] = [];
  if (voltar) {
    itens.push({
      id: `${PREFIXO_PAGINA}0`,
      title: "◀ Voltar ao início",
      description: "Mostrar as primeiras datas de novo",
    });
  }
  itens.push(...pagina.map(itemDoShow));
  if (restantes > 0) {
    itens.push({
      id: `${PREFIXO_PAGINA}${inicio + pagina.length}`,
      title: "▶ Ver mais datas",
      description: restantes === 1
        ? "Mais 1 show depois desta data"
        : `Mais ${restantes} shows depois desta data`,
    });
  }
  return itens;
}

/** Tela inicial: a lista. Sem shows, o texto explica em vez de mostrar vazio. */
export function telaAgenda(
  shows: ShowRow[],
  artista: string | null,
  offset = 0,
  tela: string = TELA_AGENDA,
) {
  const maxItens = tela === TELA_AGENDA_LONGA ? MAX_ITENS_DROPDOWN : MAX_ITENS;
  const itens = montarLista(shows, offset, maxItens);
  return {
    screen: tela,
    data: {
      // O cabeçalho diz em que página a pessoa está: sem isso, a segunda
      // leva de datas parece a mesma tela sem explicação de por que mudou.
      titulo: [artista ? `Próximos shows — ${artista}` : "Próximos shows",
        offset > 0 ? "(continuação)" : null].filter(Boolean).join(" "),
      tem_shows: itens.length > 0,
      // `sem_shows` existe porque a linguagem de expressão do Flow JSON não
      // tem negação: `${!data.tem_shows}` é recusado na validação da Meta.
      sem_shows: itens.length === 0,
      vazio_texto: "Ainda não há datas confirmadas por aqui. Fique de olho que a gente avisa!",
      shows: itens,
    },
  };
}

/** Tela de detalhe de um show. */
/**
 * Detalhe do show, com a arte e a sinopse do espetáculo quando existirem.
 *
 * Cada campo opcional vai com seu par `tem_x`/`sem_x` porque a linguagem de
 * expressão do Flow JSON não tem negação (`${!data.x}` é recusado na
 * validação da Meta) — mesmo motivo do `tem_shows`/`sem_shows` da lista.
 *
 * `imagem` é base64 puro, sem prefixo `data:`: é o que o componente `Image`
 * do Flow espera. Espetáculo sem arte (ou com arte recusada por tamanho)
 * manda string vazia e `tem_imagem: false` — a tela some o componente em vez
 * de tentar desenhar nada.
 *
 * `imagem_proporcao` é largura/altura da arte, e vai para o `aspect-ratio` do
 * componente: é o que faz um banner 2.34:1 aparecer como faixa larga e uma
 * arte quadrada aparecer quadrada, sem corte e sem sobra. Sem dimensão
 * conhecida, cai em 1 (o default da Meta) — pior enquadramento, nunca tela
 * quebrada.
 */
export function telaDetalhe(show: ShowRow, tema?: TemaRow | null, tela: string = TELA_DETALHE) {
  const sinopse = tema?.sinopse?.trim() ?? "";
  const imagem = tema?.imagem_base64 ?? "";
  const largura = tema?.imagem_largura ?? 0;
  const altura = tema?.imagem_altura ?? 0;
  const proporcao = largura > 0 && altura > 0
    ? Math.round((largura / altura) * 100) / 100
    : 1;

  return {
    screen: tela,
    data: {
      titulo: [show.cidade, show.teatro].filter(Boolean).join(" · ") || "Show",
      quando: formatarData(show.data_show),
      // Status e selos no mesmo campo, pelo mesmo motivo da lista: campo novo
      // na tela exigiria republicar o Flow.
      status: [show.status_venda, show.label_periodo, show.label_ingressos]
        .filter(Boolean).join(" · "),
      // Nome do espetáculo: é o que dá contexto à arte, e o fã de um artista
      // com dois espetáculos em cartaz precisa saber qual é qual.
      espetaculo: tema?.nome ?? show.espetaculo ?? "",
      tem_espetaculo: Boolean(tema?.nome ?? show.espetaculo),
      sem_espetaculo: !(tema?.nome ?? show.espetaculo),
      sinopse,
      tem_sinopse: sinopse.length > 0,
      sem_sinopse: sinopse.length === 0,
      imagem,
      imagem_proporcao: proporcao,
      tem_imagem: imagem.length > 0,
      sem_imagem: imagem.length === 0,
      tem_link: Boolean(show.link_compra),
      link_compra: show.link_compra ?? "",
    },
  };
}
