// Regras do card de show na página pública.
//
// Formato de referência (decisão do fundador, 17/09/2026): data à esquerda,
// espetáculo/cidade no meio, chips de selo, e um botão de ação à direita — o
// desenho de agenda de ticketeira.
//
// Isto é regra de negócio, não formatação: o que o botão DIZ muda o que a
// pessoa espera encontrar do outro lado. Por isso vive aqui, puro e testável,
// e não espalhado no JSX.

export interface ShowParaCard {
  status_venda: string | null;
  link_compra: string | null;
  label_ingressos: string | null;
  label_periodo: string | null;
  data_show: string | null;
}

export type AcaoShow =
  | { tipo: "ingressos"; rotulo: string }
  | { tipo: "lista_espera"; rotulo: string }
  | { tipo: "esgotado"; rotulo: string }
  | { tipo: "sem_acao" };

function sem(texto: string | null | undefined): string {
  return (texto ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
}

/**
 * O que o botão do show faz.
 *
 * Ordem importa:
 *  - esgotado ganha de tudo (mandar alguém para uma página de compra sem
 *    ingresso é pior que não ter botão);
 *  - confirmado, ou qualquer show sem link de compra, vira lista de espera —
 *    mas só se a página tiver onde captar. Sem destino, nenhum botão: botão
 *    que não leva a nada é pior que ausência de botão.
 */
export function acaoDoShow(show: ShowParaCard, urlListaEspera?: string | null): AcaoShow {
  const status = sem(show.status_venda);
  const temLink = !!show.link_compra?.trim();
  const temEspera = !!urlListaEspera?.trim();

  if (status.includes("esgotad")) return { tipo: "esgotado", rotulo: "Esgotado" };
  if (status.includes("confirmado") || !temLink) {
    return temEspera
      ? { tipo: "lista_espera", rotulo: "Lista de espera" }
      : { tipo: "sem_acao" };
  }
  return { tipo: "ingressos", rotulo: "Ver ingressos" };
}

/**
 * Selos do card, sem repetição.
 *
 * O período é DERIVADO da data, e o rótulo do board entra só se disser outra
 * coisa. Motivo: "Amanhã" é fato da data mantido à mão no Monday, e rótulo
 * desse tipo envelhece — mantido assim, um show viraria "Amanhã" para sempre.
 * Derivar nunca erra e não dá trabalho a ninguém.
 */
export function selosDoShow(show: ShowParaCard, agora: Date): string[] {
  const selos: string[] = [];

  const periodo = periodoDerivado(show.data_show, agora);
  if (periodo) selos.push(periodo);
  if (show.label_periodo && sem(show.label_periodo) !== sem(periodo)) selos.push(show.label_periodo);

  // Status só vira chip quando diz algo que o botão não diz. "à venda" é o
  // que o "Ver ingressos" já comunica; "confirmado" é a informação nova
  // (existe, mas ainda não vende).
  if (sem(show.status_venda).includes("confirmado")) selos.push("Confirmado");

  if (show.label_ingressos) selos.push(show.label_ingressos);

  return selos;
}

/** "Hoje", "Amanhã", "Neste fim de semana" — ou nada. Em horário de Brasília. */
export function periodoDerivado(dataShow: string | null, agora: Date): string | null {
  if (!dataShow) return null;

  const dia = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

  const data = new Date(dataShow);
  if (Number.isNaN(data.getTime())) return null;

  const hoje = dia(agora);
  const amanha = dia(new Date(agora.getTime() + 86_400_000));
  const doShow = dia(data);

  if (doShow === hoje) return "Hoje";
  if (doShow === amanha) return "Amanhã";

  // Fim de semana a seguir: sábado ou domingo dentro dos próximos 6 dias. Um
  // show de terça não é "neste fim de semana" só por estar a 4 dias.
  const diaDaSemana = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    weekday: "short",
  }).format(data);

  const meioDia = (yyyymmdd: string) => new Date(`${yyyymmdd}T12:00:00-03:00`).getTime();
  const diasAte = Math.round((meioDia(doShow) - meioDia(hoje)) / 86_400_000);

  if ((diaDaSemana === "Sat" || diaDaSemana === "Sun") && diasAte >= 0 && diasAte <= 6) {
    return "Neste fim de semana";
  }

  return null;
}

/** Partes da data para o bloco à esquerda do card. */
export function dataDoCard(iso: string | null): { mes: string; dia: string; semana: string; hora: string } | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;

  const fmt = (opcoes: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", ...opcoes }).format(d);

  return {
    mes: fmt({ month: "short" }).replace(".", "").toLowerCase(),
    dia: fmt({ day: "2-digit" }),
    semana: fmt({ weekday: "short" }).replace(".", "").toLowerCase(),
    // Meia-noite exata é o sinal de "hora não informada" (mesma convenção do
    // Flow, migration agenda_temas_dimensoes).
    hora: fmt({ hour: "2-digit", minute: "2-digit" }) === "00:00" ? "" : fmt({ hour: "2-digit", minute: "2-digit" }),
  };
}
