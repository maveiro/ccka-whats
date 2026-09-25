// Como as colunas do CSV viram parâmetros do template.
//
// Existe em arquivo próprio para ter teste direto (template_variaveis.e2e.ts):
// a regra é pequena e silenciosa — quando erra, a Graph API recusa TODOS os
// envios com o mesmo 400, e a campanha inteira morre sem uma linha sequer
// entregue. Foi o que aconteceu em 18/09/2026 com `ib_natal_vendasabertas_poa`:
// o template tinha a variável no CABEÇALHO ("Olá, {{1}}"), o disparador mandava
// tudo como parâmetro de CORPO, e a Meta respondeu
// "(#132000) Number of parameters does not match the expected number of params"
// para os três destinatários, três tentativas cada.

export interface PlanoDeVariaveis {
  /** Quantos placeholders o cabeçalho de TEXTO espera (a Meta permite no máximo 1). */
  header: number;
  /** Quantos o corpo espera. */
  body: number;
  /** Cabeçalho de mídia (IMAGE/VIDEO/DOCUMENT), que exige um parâmetro que ainda não montamos. */
  headerMidia: string | null;
}

function contarPlaceholders(texto: unknown): number {
  if (typeof texto !== "string") return 0;
  const achados = texto.match(/\{\{\s*\d+\s*\}\}/g);
  // `Set` porque a Meta conta placeholders DISTINTOS: um texto que repete
  // {{1}} duas vezes continua esperando um parâmetro só.
  return achados ? new Set(achados.map((m) => m.replace(/\s/g, ""))).size : 0;
}

/**
 * Lê o template (components como a Graph API devolve) e diz quantos
 * parâmetros cada parte espera.
 *
 * Cabeçalho e corpo numeram os placeholders de forma INDEPENDENTE — os dois
 * começam em {{1}} —, então não dá para deduzir o destino pelo número. O que
 * decide é em qual componente o placeholder está.
 */
export function planoDeVariaveis(componentes: unknown): PlanoDeVariaveis {
  const plano: PlanoDeVariaveis = { header: 0, body: 0, headerMidia: null };
  if (!Array.isArray(componentes)) return plano;

  for (const c of componentes) {
    const comp = c as { type?: string; format?: string; text?: string };
    const tipo = comp?.type?.toUpperCase();

    if (tipo === "HEADER") {
      const formato = comp.format?.toUpperCase() ?? "TEXT";
      if (formato === "TEXT") plano.header = contarPlaceholders(comp.text);
      else plano.headerMidia = formato;
    }

    if (tipo === "BODY") plano.body = contarPlaceholders(comp.text);
  }

  return plano;
}

/**
 * Divide as variáveis da pessoa entre cabeçalho e corpo.
 *
 * A ordem é a do CSV: **primeiro as do cabeçalho, depois as do corpo** — é a
 * convenção que a tela de criação anuncia, e a única possível, já que a
 * numeração dos dois recomeça em {{1}}.
 *
 * Sobra ou falta não é corrigida aqui de propósito: mandar o que veio deixa a
 * Meta recusar com a mensagem certa, que fica no `error` do destinatário. O
 * lugar de impedir a divergência é a criação da campanha, antes de existir
 * base para disparar.
 */
export function dividirVariaveis(
  variaveis: Record<string, unknown>,
  plano: PlanoDeVariaveis,
): { header: string[]; body: string[] } {
  const chaves = Object.keys(variaveis).sort((a, b) => Number(a) - Number(b));
  const valores = chaves.map((k) => String(variaveis[k]));
  return {
    header: valores.slice(0, plano.header),
    body: valores.slice(plano.header),
  };
}

/**
 * Componente de cabeçalho para template com mídia (IMAGE/VIDEO/DOCUMENT).
 *
 * A mídia vai por LINK — a Meta baixa a URL no envio, sem upload nem handle.
 * Devolve null quando o template não tem cabeçalho de mídia, e lança quando
 * tem e a campanha não trouxe URL: enviar assim faz a Meta recusar 100% dos
 * envios, e o chamador precisa decidir isso ANTES do primeiro.
 */
export function componenteDeMidia(
  plano: PlanoDeVariaveis,
  url: string | null | undefined,
): unknown | null {
  if (!plano.headerMidia) return null;
  const formato = plano.headerMidia;
  if (formato !== "IMAGE" && formato !== "VIDEO" && formato !== "DOCUMENT") {
    throw new Error(`Cabeçalho de mídia "${formato}" não suportado`);
  }
  if (!url || !url.trim()) {
    throw new Error(`O template tem cabeçalho de ${formato}, mas a campanha não trouxe a URL da mídia`);
  }
  const tipo = formato.toLowerCase();
  return {
    type: "header",
    parameters: [{ type: tipo, [tipo]: { link: url.trim() } }],
  };
}
