// Normalização e match de palavra-chave (passo 7 do fluxo técnico do PRD).
//
// Match é por regra fixa, sem IA — decisão de posicionamento, não limitação
// técnica (ver CLAUDE.md, "Segunda reabertura parcial e consciente").

export interface PalavraChave {
  id: string;
  palavra_chave: string;
  tipo_resposta: string; // texto | link | abrir_flow
  resposta: string | null;
  flow_destino_id: string | null;
}

/**
 * Minúsculas, sem acento e sem pontuação de borda. O critério de teste do PRD
 * é explícito: "keyword bate (incluindo variação de acento/maiúscula/plural)".
 * Acento e caixa saem aqui; plural é tratado no match.
 */
export function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // remove diacríticos
    .replace(/[^\p{L}\p{N}\s]/gu, " ") // pontuação vira separador
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Plural simples do português: "ingressos" casa com a keyword "ingresso".
 * Só remove o "s" final de palavras com 4+ letras — evita transformar "mais"
 * em "mai" ou "shows" em algo que não existe como keyword cadastrada.
 */
function semPlural(palavra: string): string {
  return palavra.length >= 4 && palavra.endsWith("s") ? palavra.slice(0, -1) : palavra;
}

function tokens(texto: string): string[] {
  return normalizar(texto).split(" ").filter(Boolean).map(semPlural);
}

/**
 * Primeira keyword que aparece no texto. Keyword de várias palavras casa como
 * sequência; de uma palavra casa como token inteiro — nunca como substring,
 * senão "ingresso" casaria dentro de "ingressos esgotados" de formas
 * surpreendentes e, pior, "não" casaria dentro de "informação".
 *
 * Ordem de avaliação: keyword mais longa (em tokens) primeiro, para que uma
 * keyword específica ("meia entrada") vença uma genérica ("entrada") quando as
 * duas casam. Sem isso o resultado dependeria da ordem de leitura do banco.
 */
export function acharKeyword(texto: string, palavras: PalavraChave[]): PalavraChave | null {
  const alvo = tokens(texto);
  if (alvo.length === 0) return null;

  const candidatas = [...palavras].sort(
    (a, b) => tokens(b.palavra_chave).length - tokens(a.palavra_chave).length,
  );

  for (const palavra of candidatas) {
    const chave = tokens(palavra.palavra_chave);
    if (chave.length === 0) continue;

    for (let i = 0; i + chave.length <= alvo.length; i++) {
      if (chave.every((t, j) => t === alvo[i + j])) return palavra;
    }
  }

  return null;
}
