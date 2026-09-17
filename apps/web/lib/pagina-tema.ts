// Tema de uma página pública. Guardado em jsonb (gosto, não estrutura), lido
// aqui com default e validação — cor inválida vinda do banco não pode virar
// CSS quebrado numa página que qualquer pessoa abre.

export interface Tema {
  cor_fundo: string;
  cor_texto: string;
  cor_botao: string;
  cor_texto_botao: string;
  estilo_botao: "arredondado" | "reto" | "pilula";
  imagem_fundo_path?: string | null;
}

export const TEMA_PADRAO: Tema = {
  cor_fundo: "#0b0b0f",
  cor_texto: "#ffffff",
  cor_botao: "#1f2430",
  cor_texto_botao: "#ffffff",
  estilo_botao: "arredondado",
  imagem_fundo_path: null,
};

const COR = /^#[0-9a-fA-F]{6}$/;
const ESTILOS = ["arredondado", "reto", "pilula"] as const;

/** Só cor hex de 6 dígitos: fecha a porta para valor que vira `style` arbitrário. */
function cor(valor: unknown, padrao: string): string {
  return typeof valor === "string" && COR.test(valor) ? valor : padrao;
}

export function lerTema(bruto: unknown): Tema {
  const t = (bruto ?? {}) as Record<string, unknown>;
  const estilo = ESTILOS.includes(t.estilo_botao as typeof ESTILOS[number])
    ? (t.estilo_botao as Tema["estilo_botao"])
    : TEMA_PADRAO.estilo_botao;

  return {
    cor_fundo: cor(t.cor_fundo, TEMA_PADRAO.cor_fundo),
    cor_texto: cor(t.cor_texto, TEMA_PADRAO.cor_texto),
    cor_botao: cor(t.cor_botao, TEMA_PADRAO.cor_botao),
    cor_texto_botao: cor(t.cor_texto_botao, TEMA_PADRAO.cor_texto_botao),
    estilo_botao: estilo,
    imagem_fundo_path: typeof t.imagem_fundo_path === "string" ? t.imagem_fundo_path : null,
  };
}

export const RAIO_DO_ESTILO: Record<Tema["estilo_botao"], string> = {
  arredondado: "0.75rem",
  reto: "0",
  pilula: "9999px",
};

/**
 * Contraste WCAG entre duas cores hex.
 *
 * Serve para o painel avisar quando a combinação escolhida fica ilegível —
 * personalização por página foi pedida, e a consequência natural é alguém
 * pôr texto branco em fundo branco. Avisar é melhor que proibir: é a página
 * do artista, não a nossa.
 */
export function contraste(a: string, b: string): number {
  const lum = (hex: string) => {
    const n = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const [r, g, bl] = n.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const la = lum(a);
  const lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
