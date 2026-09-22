// Monta e valida o `components` de um template ANTES de submeter à Meta.
//
// Puro e testável (mesmo padrão de lib/show-card.ts): nada de `env` nem
// `server-only` aqui — quem chama passa o domínio público já resolvido. É o
// que permite testar a validação inteira (a parte que custa acertar) sem
// depender do runtime Next.
//
// Limites de caractere e formato de `example` seguem a doc da Meta: cabeçalho
// de texto até 60 chars e no máximo 1 variável; corpo até 1024 e até 15;
// `example.header_text` é array plano; `example.body_text` é uma lista de
// UMA lista com todos os valores, na ordem; botão de URL dinâmica leva a URL
// RESOLVIDA (não só o token) em `example` — confirmado contra a doc da Meta,
// não é intuitivo.

export const LIMITE_HEADER = 60;
export const LIMITE_BODY = 1024;
export const LIMITE_FOOTER = 60;
export const MAX_VARIAVEIS_BODY = 15;

export type FormatoMidia = "IMAGE" | "VIDEO" | "DOCUMENT";

export interface TemplateFormInput {
  headerTexto: string | null;
  bodyTexto: string;
  footerTexto: string | null;
  headerExemplo: string | null;
  bodyExemplos: string[];
  /** Cabeçalho de mídia — mutuamente exclusivo com headerTexto. */
  headerMidia: null | { formato: FormatoMidia; handle: string };
  botao: null | {
    texto: string;
    modo: "rastreada" | "estatica" | "flow" | "quick_reply";
    /** Só usado quando modo === "estatica". */
    urlEstatica?: string;
    /** Só usados quando modo === "flow". */
    flowId?: string;
    navigateScreen?: string;
  };
}

export interface MontagemResultado {
  ok: boolean;
  erro?: string;
  components?: unknown[];
}

/**
 * Placeholders DISTINTOS de um texto, na ordem — {{1}}, {{2}}... Exportada
 * (não só interna) porque a tela usa a mesma contagem para saber quantos
 * campos de "valor de exemplo" desenhar, sem duplicar a regex uma terceira
 * vez.
 */
export function placeholders(texto: string): number[] {
  const achados = texto.match(/\{\{\s*(\d+)\s*\}\}/g) ?? [];
  const numeros = new Set(achados.map((m) => Number(m.replace(/\D/g, ""))));
  return [...numeros].sort((a, b) => a - b);
}

/** {{1}}, {{2}}, {{3}}... sem pular número — Meta recusa lacuna na sequência. */
function sequencial(nums: number[]): boolean {
  return nums.every((n, i) => n === i + 1);
}

/**
 * `true` se houver LETRA ou DÍGITO real no trecho — pontuação e espaço
 * sozinhos não contam. É o que separa "às 20h." (conteúdo de verdade) de só
 * "." (nada).
 */
function temConteudoReal(trecho: string): boolean {
  return /\p{L}|\p{N}/u.test(trecho);
}

/**
 * O CORPO não pode COMEÇAR nem TERMINAR em variável — regra real da Meta,
 * descoberta testando contra a Graph API em 22/09/2026, e que NENHUMA doc
 * consultada mencionava (nem a oficial, nem os writeups de terceiros
 * buscados). "Seu show é dia {{1}}." é recusado (`error_subcode 2388299`,
 * "As variáveis não podem estar no início ou no fim do modelo"); "Seu show é
 * dia {{1}} às 20h." é aceito — pontuação sozinha depois da variável não
 * conta como "fim" ter conteúdo, só letra/dígito conta. Confirmado que essa
 * regra NÃO vale para o cabeçalho: "Olá, {{1}}!" (variável no fim) e
 * "{{1}}, seu horário chegou" (variável no início) foram aceitos os dois.
 */
export function variavelNaBordaDoCorpo(texto: string): boolean {
  const primeira = texto.match(/\{\{\s*\d+\s*\}\}/);
  if (!primeira) return false;
  const ultima = [...texto.matchAll(/\{\{\s*\d+\s*\}\}/g)].at(-1)!;

  const antes = texto.slice(0, primeira.index);
  const depois = texto.slice((ultima.index ?? 0) + ultima[0].length);

  return !temConteudoReal(antes) || !temConteudoReal(depois);
}

/**
 * `linkBaseUrl` é o domínio público (NEXT_PUBLIC_LINK_BASE_URL) já resolvido
 * pelo chamador — null quando a variável não está configurada, e nesse caso
 * "rastreada" é recusada (sem domínio não tem para onde montar a URL).
 */
export function montarComponentes(
  input: TemplateFormInput,
  linkBaseUrl: string | null,
): MontagemResultado {
  const components: unknown[] = [];

  // ── Cabeçalho ──────────────────────────────────────────────────────────
  const header = input.headerTexto?.trim() ?? "";
  if (input.headerMidia && header) {
    return { ok: false, erro: "Cabeçalho não pode ser texto e mídia ao mesmo tempo." };
  }
  if (input.headerMidia) {
    // Sem `text`: o cabeçalho de mídia é só a imagem/vídeo/documento — nada
    // de texto no lugar. `example.header_handle` é o handle da Resumable
    // Upload API, não a mídia em si (confirmado ao vivo, 22/09/2026).
    components.push({
      type: "HEADER",
      format: input.headerMidia.formato,
      example: { header_handle: [input.headerMidia.handle] },
    });
  } else if (header) {
    if (header.length > LIMITE_HEADER) {
      return { ok: false, erro: `Cabeçalho passou de ${LIMITE_HEADER} caracteres (tem ${header.length}).` };
    }
    const vars = placeholders(header);
    if (vars.length > 1) {
      return { ok: false, erro: "Cabeçalho aceita no máximo 1 variável." };
    }
    if (vars.length === 1 && (vars[0] !== 1 || !sequencial(vars))) {
      return { ok: false, erro: "A variável do cabeçalho precisa ser {{1}}." };
    }
    if (vars.length === 1 && !input.headerExemplo?.trim()) {
      return { ok: false, erro: "Falta o valor de exemplo da variável do cabeçalho." };
    }
    components.push({
      type: "HEADER",
      format: "TEXT",
      text: header,
      ...(vars.length === 1 ? { example: { header_text: [input.headerExemplo!.trim()] } } : {}),
    });
  }

  // ── Corpo ──────────────────────────────────────────────────────────────
  const body = input.bodyTexto.trim();
  if (!body) return { ok: false, erro: "O corpo do template não pode ficar vazio." };
  if (body.length > LIMITE_BODY) {
    return { ok: false, erro: `Corpo passou de ${LIMITE_BODY} caracteres (tem ${body.length}).` };
  }
  const varsBody = placeholders(body);
  if (varsBody.length > MAX_VARIAVEIS_BODY) {
    return { ok: false, erro: `Corpo tem ${varsBody.length} variáveis; a Meta aceita até ${MAX_VARIAVEIS_BODY}.` };
  }
  if (varsBody.length > 0 && !sequencial(varsBody)) {
    return { ok: false, erro: "As variáveis do corpo precisam ser {{1}}, {{2}}... sem pular número." };
  }
  if (varsBody.length > 0 && variavelNaBordaDoCorpo(body)) {
    return {
      ok: false,
      erro: "A variável não pode ser a primeira nem a última coisa do corpo — " +
        "precisa de uma palavra de verdade antes e depois (pontuação sozinha não conta).",
    };
  }
  const exemplosBody = input.bodyExemplos.map((v) => v.trim()).filter(Boolean);
  if (varsBody.length > 0 && exemplosBody.length !== varsBody.length) {
    return {
      ok: false,
      erro: `Corpo usa ${varsBody.length} variável(is); faltam valores de exemplo (${exemplosBody.length} preenchidos).`,
    };
  }
  components.push({
    type: "BODY",
    text: body,
    ...(varsBody.length > 0 ? { example: { body_text: [exemplosBody] } } : {}),
  });

  // ── Rodapé ─────────────────────────────────────────────────────────────
  const footer = input.footerTexto?.trim() ?? "";
  if (footer) {
    if (footer.length > LIMITE_FOOTER) {
      return { ok: false, erro: `Rodapé passou de ${LIMITE_FOOTER} caracteres (tem ${footer.length}).` };
    }
    if (placeholders(footer).length > 0) {
      return { ok: false, erro: "Rodapé não aceita variável." };
    }
    components.push({ type: "FOOTER", text: footer });
  }

  // ── Botão ──────────────────────────────────────────────────────────────
  if (input.botao) {
    const texto = input.botao.texto.trim();
    if (!texto) return { ok: false, erro: "Falta o texto do botão." };

    if (input.botao.modo === "quick_reply") {
      // Simples: sem URL, sem exemplo — a Meta só quer o texto. É este
      // botão que vira `button_reply` rastreável na resposta (mesma
      // mecânica de opt-out por texto de botão, migration 0022).
      components.push({ type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: texto }] });
    } else if (input.botao.modo === "flow") {
      // Botão de Flow no TEMPLATE (diferente do Flow oferecido pelo
      // flow-engine numa resposta): quem monta o template escolhe qual
      // central abrir, e a validação de "é o mesmo número, está ativo, está
      // publicado" já aconteceu na rota antes de chegar aqui (mesma
      // checagem de POST /api/campaigns, regra 37).
      //
      // `flow_action: "navigate"` exige `navigate_screen` — a tela de
      // entrada do Flow. Usamos a mesma que `flow-endpoint` resolveria no
      // INIT (whatsapp_flows.tela_inicial quando setada, senão o padrão do
      // tipo), para o botão do template abrir NO MESMO lugar que o balão
      // interativo abriria.
      if (!input.botao.flowId || !input.botao.navigateScreen) {
        return { ok: false, erro: "Falta escolher o Flow (e a tela de entrada) do botão." };
      }
      components.push({
        type: "BUTTONS",
        buttons: [{
          type: "FLOW",
          text: texto,
          flow_id: input.botao.flowId,
          flow_action: "navigate",
          navigate_screen: input.botao.navigateScreen,
        }],
      });
    } else if (input.botao.modo === "rastreada") {
      // Convenção da regra 32/37 do CLAUDE.md: a Graph API ANEXA o valor no
      // fim da URL, então ela precisa TERMINAR em /c/{{1}} — nunca no meio.
      if (!linkBaseUrl) {
        return {
          ok: false,
          erro: "O domínio público (NEXT_PUBLIC_LINK_BASE_URL) não está configurado — sem ele não dá para montar a URL rastreada.",
        };
      }
      const base = linkBaseUrl.replace(/\/+$/, "");
      const url = `${base}/c/{{1}}`;
      const exemplo = `${base}/c/k7Qm2xR9tA`;
      components.push({
        type: "BUTTONS",
        buttons: [{ type: "URL", text: texto, url, example: [exemplo] }],
      });
    } else {
      const urlEstatica = input.botao.urlEstatica?.trim() ?? "";
      if (!urlEstatica) return { ok: false, erro: "Falta a URL do botão." };
      if (urlEstatica.includes("{{")) {
        return {
          ok: false,
          erro: "URL fixa não pode ter variável — para link com {{1}}, use a opção rastreada.",
        };
      }
      try {
        new URL(urlEstatica);
      } catch {
        return { ok: false, erro: "URL do botão inválida." };
      }
      components.push({
        type: "BUTTONS",
        buttons: [{ type: "URL", text: texto, url: urlEstatica }],
      });
    }
  }

  return { ok: true, components };
}

export interface ComponentesParseados {
  headerTexto: string | null;
  headerExemplo: string | null;
  /**
   * Só o FORMATO do cabeçalho de mídia que já existia — o handle antigo NÃO
   * é reaproveitável (é de uma sessão de upload já fechada, e a doc da Meta
   * avisa que o handle é de curta duração). Editar um template com
   * cabeçalho de mídia exige subir o arquivo de novo.
   */
  headerMidiaFormato: FormatoMidia | null;
  bodyTexto: string;
  bodyExemplos: string[];
  footerTexto: string | null;
  botao: null | {
    modo: "rastreada" | "estatica" | "flow" | "quick_reply";
    texto: string;
    urlEstatica?: string;
    /** flow_id da META (não o nosso uuid) — quem chama casa contra whatsapp_flows.meta_flow_id. */
    flowMetaId?: string;
  };
}

/**
 * Lê de volta um `components` que a Meta já tem (para pré-preencher o
 * formulário de EDIÇÃO — só templates REJECTED aceitam edição, achado
 * testando ao vivo em 22/09/2026). Best-effort e nunca lança: um template
 * criado fora da plataforma pode ter forma que o formulário não sabe editar
 * (ex.: `parameter_format: "named"`, fora de escopo — ver PRD); nesse caso
 * os campos ficam em branco, e a pessoa preenche de novo, em vez de a tela
 * quebrar.
 */
export function formularioAPartirDeComponentes(components: unknown[]): ComponentesParseados {
  const resultado: ComponentesParseados = {
    headerTexto: null,
    headerExemplo: null,
    headerMidiaFormato: null,
    bodyTexto: "",
    bodyExemplos: [],
    footerTexto: null,
    botao: null,
  };
  if (!Array.isArray(components)) return resultado;

  for (const c of components) {
    const comp = c as {
      type?: string;
      format?: string;
      text?: string;
      example?: { header_text?: string[]; body_text?: string[][] };
      buttons?: {
        type?: string;
        text?: string;
        url?: string;
        flow_id?: string;
      }[];
    };
    const tipo = comp?.type?.toUpperCase();

    if (tipo === "HEADER") {
      const formato = comp.format?.toUpperCase();
      if (formato === "TEXT") {
        resultado.headerTexto = comp.text ?? null;
        resultado.headerExemplo = comp.example?.header_text?.[0] ?? null;
      } else if (formato === "IMAGE" || formato === "VIDEO" || formato === "DOCUMENT") {
        resultado.headerMidiaFormato = formato;
      }
    }

    if (tipo === "BODY") {
      resultado.bodyTexto = comp.text ?? "";
      resultado.bodyExemplos = comp.example?.body_text?.[0] ?? [];
    }

    if (tipo === "FOOTER") {
      resultado.footerTexto = comp.text ?? null;
    }

    if (tipo === "BUTTONS" && Array.isArray(comp.buttons) && comp.buttons[0]) {
      const b = comp.buttons[0];
      const btnTipo = b.type?.toUpperCase();
      if (btnTipo === "URL" && b.url) {
        const rastreada = /\/c\/\{\{\s*1\s*\}\}$/.test(b.url);
        resultado.botao = {
          modo: rastreada ? "rastreada" : "estatica",
          texto: b.text ?? "",
          ...(rastreada ? {} : { urlEstatica: b.url }),
        };
      } else if (btnTipo === "FLOW" && b.flow_id) {
        resultado.botao = { modo: "flow", texto: b.text ?? "", flowMetaId: b.flow_id };
      } else if (btnTipo === "QUICK_REPLY") {
        resultado.botao = { modo: "quick_reply", texto: b.text ?? "" };
      }
    }
  }

  return resultado;
}

/** name da Meta: só minúsculo, dígito e "_", até 512 — deriva do título que o admin digita. */
export function slugifyNomeTemplate(titulo: string): string {
  return titulo
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 512);
}
