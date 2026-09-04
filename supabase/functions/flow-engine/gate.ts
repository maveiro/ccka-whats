// Máquina de estado do gate de cadastro (passo 5 do fluxo técnico do PRD).
//
// É o pedaço mais novo do motor e o que mais acumulou correção nas seis
// rodadas de simulação do PRD. Regras que NÃO podem se perder numa refatoração:
//
//  - nenhum campo trava a conversa pra sempre: 2 tentativas falhas no mesmo
//    campo → avança com o campo nulo e marca pulou_cadastro
//  - a pergunta original nunca se perde: vai pra mensagem_pendente e é
//    respondida quando o cadastro completa
//  - mensagem que não valida durante o gate é CONCATENADA em mensagem_pendente,
//    não descartada nem forçada como resposta do campo
//  - resposta que parece pergunta/frase não é nome ("quero saber sobre o show
//    de sábado" não é um nome)

export const MAX_TENTATIVAS_POR_CAMPO = 2;

export type CampoGate = "nome" | "email";

export interface ValidacaoResultado {
  valido: boolean;
  valor?: string;
}

/**
 * Nome: 2 a 60 caracteres, com letra, e que não pareça frase/pergunta.
 * O corte de 5 palavras e o "?" vêm da rodada 5 do PRD — sem eles, a pergunta
 * real da pessoa entrava na base como se fosse o nome dela, contaminando
 * justamente o dado que o projeto existe pra construir.
 */
export function validarNome(texto: string): ValidacaoResultado {
  const valor = texto.trim().replace(/\s+/g, " ");

  if (valor.length < 2 || valor.length > 60) return { valido: false };
  if (valor.includes("?")) return { valido: false };
  if (valor.split(" ").length > 5) return { valido: false };
  if (!/\p{L}/u.test(valor)) return { valido: false }; // só número/símbolo
  if (/^\p{N}+$/u.test(valor)) return { valido: false };

  return { valido: true, valor };
}

/**
 * E-mail: validação deliberadamente simples. O objetivo é barrar erro de
 * digitação óbvio e resposta que não é e-mail — não implementar RFC 5322.
 */
export function validarEmail(texto: string): ValidacaoResultado {
  const valor = texto.trim().toLowerCase();
  if (valor.length > 254) return { valido: false };
  if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(valor)) return { valido: false };
  return { valido: true, valor };
}

export function validarCampo(campo: CampoGate, texto: string): ValidacaoResultado {
  return campo === "nome" ? validarNome(texto) : validarEmail(texto);
}

// ─── Textos do gate ──────────────────────────────────────────────────────────
//
// Provisórios: o PRD determina que boas-vindas, fallback e a abertura do gate
// são entregáveis de COPY (Sprint A2, voz do artista), não campo preenchido por
// quem sobe o Flow. Ficam aqui porque o motor precisa de algo pra mandar antes
// da A2 existir; a menção ao motivo do dado (LGPD) já está incorporada porque
// é requisito, não estilo.
export const TEXTOS = {
  pedirNome: "Oi! Antes de continuar, como você se chama? (guardamos seu nome e e-mail só para te atender e avisar sobre novidades — você pode pedir a remoção quando quiser)",
  pedirEmail: "Obrigado! E qual seu e-mail?",
  nomeInvalido: "Não consegui entender seu nome. Pode escrever só o nome, por favor?",
  emailInvalido: "Esse e-mail parece incompleto. Pode conferir e mandar de novo?",
  soTexto: "Consigo ler só mensagens de texto por aqui. Pode escrever, por favor?",
} as const;

export function perguntaDoCampo(campo: CampoGate): string {
  return campo === "nome" ? TEXTOS.pedirNome : TEXTOS.pedirEmail;
}

export function reperguntaDoCampo(campo: CampoGate): string {
  return campo === "nome" ? TEXTOS.nomeInvalido : TEXTOS.emailInvalido;
}

/** Próximo campo do gate; null significa cadastro concluído. */
export function proximoCampo(campo: CampoGate): CampoGate | null {
  return campo === "nome" ? "email" : null;
}

/**
 * Junta a mensagem nova ao que já estava pendente, sem perder nem duplicar.
 * (rodada 5: "mensagem extra durante o gate é concatenada, não descartada")
 */
export function concatenarPendente(atual: string | null, nova: string): string {
  const limpa = nova.trim();
  if (!atual || atual.trim().length === 0) return limpa;
  if (atual.includes(limpa)) return atual;
  return `${atual}\n${limpa}`;
}
