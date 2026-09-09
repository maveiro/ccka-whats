// Telas da Central de Shows (Sprint C1).
// PRD: docs/prd/prd-central-de-shows.md
//
// Contrato com o JSON do Flow publicado no WhatsApp Manager — nomes de tela e
// chaves de `data` precisam casar com docs/flows/central_de_shows.flow.json.
//
// Lembretes que valeram caro no Flow de agenda:
//   - a linguagem de expressão do Flow JSON NÃO tem negação: mandar o par
//     pronto (`tem_x` e `sem_x`), nunca `${!data.tem_x}`
//   - referência a campo de formulário usa o prefixo LITERAL `form`
//     (`${form.campo}`), não o nome dado ao componente Form

export const TELA_MENU = "MENU";
export const TELA_FAQ_LISTA = "FAQ_LISTA";
export const TELA_FAQ_RESPOSTA = "FAQ_RESPOSTA";
export const TELA_APRESENTACAO = "APRESENTACAO";

// Teto de itens: payload de Flow tem limite de tamanho, e lista longa é ruim de
// usar no celular. Se o FAQ crescer além disso, vira paginação — não aumentar
// este número sem medir.
const MAX_FAQ = 15;

export interface FaqItem {
  id: string;
  pergunta: string;
  resposta: string;
}

export function telaMenu(artista: string | null, nomeCliente: string | null) {
  const saudacao = nomeCliente ? `Olá, ${nomeCliente}!` : "Olá!";
  return {
    screen: TELA_MENU,
    data: {
      titulo: artista ? `Central de shows — ${artista}` : "Central de shows",
      saudacao,
      subtitulo: "O que você quer ver agora?",
    },
  };
}

export function telaFaqLista(itens: FaqItem[]) {
  const lista = itens.slice(0, MAX_FAQ).map((i) => ({
    id: i.id,
    title: i.pergunta.slice(0, 80),
  }));
  return {
    screen: TELA_FAQ_LISTA,
    data: {
      titulo: "Perguntas frequentes",
      tem_itens: lista.length > 0,
      sem_itens: lista.length === 0,
      vazio_texto: "Ainda não temos perguntas cadastradas por aqui.",
      itens: lista,
    },
  };
}

export function telaFaqResposta(item: FaqItem) {
  return {
    screen: TELA_FAQ_RESPOSTA,
    data: {
      pergunta: item.pergunta,
      resposta: item.resposta,
    },
  };
}

/**
 * Tela de quem chega sem cadastro. O cadastro em si é a Sprint C3 — aqui a
 * central se apresenta e explica por que vai pedir os dados, em vez de mostrar
 * um menu que não corresponde a ninguém.
 */
export function telaApresentacao(artista: string | null, nomeCliente: string | null) {
  const conhecido = Boolean(nomeCliente);
  return {
    screen: TELA_APRESENTACAO,
    data: {
      titulo: artista ? `Central de shows — ${artista}` : "Central de shows",
      texto: conhecido
        ? `Olá, ${nomeCliente}! Aqui você vê as próximas datas e tira suas dúvidas.`
        : "Aqui você vê as próximas datas, tira dúvidas e fica sabendo das novidades em primeira mão.",
      // Para quem já é cadastrado, repetir o aviso de coleta a cada abertura
      // seria ruído: o dado já foi dado e o consentimento já está registrado.
      aviso_lgpd: conhecido
        ? "Seus dados ficam guardados só para te atender — você pode pedir a remoção quando quiser."
        : "Para continuar, vamos pedir seu nome e e-mail. Usamos esses dados só para te atender e avisar sobre shows — você pode pedir a remoção quando quiser.",
    },
  };
}
