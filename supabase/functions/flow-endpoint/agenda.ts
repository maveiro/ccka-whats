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

// Teto de itens por resposta: payload de Flow tem limite de tamanho, e uma
// lista gigante é ruim de usar no celular de qualquer forma.
const MAX_SHOWS = 20;

export interface ShowRow {
  id: string;
  artista: string;
  cidade: string | null;
  teatro: string | null;
  data_show: string | null;
  status_venda: string | null;
  link_compra: string | null;
}

interface ItemLista {
  id: string;
  title: string;
  description: string;
}

function formatarData(iso: string | null): string {
  if (!iso) return "data a confirmar";
  // pt-BR com fuso de São Paulo: o servidor roda em UTC, e sem isso um show às
  // 21h aparece como 00h do dia seguinte.
  return new Date(iso).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function montarLista(shows: ShowRow[]): ItemLista[] {
  return shows.slice(0, MAX_SHOWS).map((s) => ({
    id: s.id,
    title: [s.cidade, s.teatro].filter(Boolean).join(" · ") || "Show",
    description: [formatarData(s.data_show), s.status_venda].filter(Boolean).join(" · "),
  }));
}

/** Tela inicial: a lista. Sem shows, o texto explica em vez de mostrar vazio. */
export function telaAgenda(shows: ShowRow[], artista: string | null) {
  const itens = montarLista(shows);
  return {
    screen: TELA_AGENDA,
    data: {
      titulo: artista ? `Próximos shows — ${artista}` : "Próximos shows",
      tem_shows: itens.length > 0,
      vazio_texto: "Ainda não há datas confirmadas por aqui. Fique de olho que a gente avisa!",
      shows: itens,
    },
  };
}

/** Tela de detalhe de um show. */
export function telaDetalhe(show: ShowRow) {
  return {
    screen: TELA_DETALHE,
    data: {
      titulo: [show.cidade, show.teatro].filter(Boolean).join(" · ") || "Show",
      quando: formatarData(show.data_show),
      status: show.status_venda ?? "",
      tem_link: Boolean(show.link_compra),
      link_compra: show.link_compra ?? "",
    },
  };
}
