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

// Identifica o texto de LGPD que a pessoa aceitou ao passar pelo gate. Trocar
// o texto de TEXTOS.pedirNome sem trocar esta versão torna o consentimento
// registrado uma informação falsa — é o par que dá sentido ao carimbo.
export const VERSAO_CONSENTIMENTO_GATE = "gate-v2-2026-09";

export type CampoGate = "nome" | "email";

export interface ValidacaoResultado {
  valido: boolean;
  valor?: string;
}

/**
 * Palavras que denunciam pergunta/pedido, não nome. Cobrem o buraco que as
 * regras do PRD deixavam: "quero ingresso" tem 2 palavras e nenhum "?", então
 * passava como nome e contaminava a base — que é justamente o dado que o
 * projeto existe pra construir. Achado ao escrever o teste e2e do gate.
 *
 * Comparadas como PALAVRA INTEIRA e sem acento: "Tomás" não pode ser
 * reprovado por conter "tom", nem "Quéren" por parecer "quer".
 */
const PALAVRAS_GATILHO = new Set([
  "quero", "queria", "gostaria", "preciso", "posso", "poderia",
  "tem", "tenho", "qual", "quais", "quanto", "quantos",
  "onde", "quando", "como", "porque", "cade",
]);

function semAcento(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/**
 * Nome: 2 a 60 caracteres, com letra, sem cara de frase/pergunta.
 * O corte de 5 palavras e o "?" vêm da rodada 5 do PRD; a lista de gatilhos
 * acima fecha o caso da pergunta curta.
 */
export function validarNome(texto: string): ValidacaoResultado {
  const valor = texto.trim().replace(/\s+/g, " ");

  if (valor.length < 2 || valor.length > 60) return { valido: false };
  if (valor.includes("?")) return { valido: false };
  if (valor.split(" ").length > 5) return { valido: false };
  if (!/\p{L}/u.test(valor)) return { valido: false }; // só número/símbolo
  if (/^\p{N}+$/u.test(valor)) return { valido: false };

  const palavras = semAcento(valor.toLowerCase())
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (palavras.some((p) => PALAVRAS_GATILHO.has(p))) return { valido: false };

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
// Copy da voz do espetáculo (decisão do fundador, 15/09/2026), substituindo os
// provisórios da Sprint A2. Ficam em CÓDIGO, e não em coluna do Flow, porque o
// gate roda antes de qualquer Flow ser escolhido — o preço é que revisar
// redação aqui exige deploy, e revisar a do Flow exige mexer no banco (regra
// 30 do CLAUDE.md: o texto de consentimento vive nos dois lugares).
//
// Limites que a redação NÃO pode perder:
//
//  - `pedirNome` carrega o texto legal (o que é guardado, para quê, e que dá
//    para pedir remoção). É o momento do aceite, e é ele que dá sentido ao
//    carimbo de VERSAO_CONSENTIMENTO_GATE — mexer aqui obriga a subir a
//    versão, senão o consentimento já registrado vira informação falsa
//    (regra 26).
//  - `pedirNome` e `nomeInvalido` precisam deixar claro que se espera SÓ o
//    nome: validarNome() reprova frase, pergunta e pedido ("quero ingresso"),
//    então um convite ambíguo produz reprovação que parece bug para quem está
//    do outro lado.
//  - a graça é do personagem, o pedido é literal. Piada que deixa dúvida
//    sobre o que responder custa uma tentativa das duas que existem antes de
//    o campo ser pulado.
//  - NENHUM texto nomeia um artista: o motor é o mesmo para todo tenant, e
//    nome fixo aqui saudaria o fã do próximo cliente com o artista errado.
//    Quem é o dono do número entra por `artista` (whatsapp_flows.artista),
//    interpolado abaixo — ausente, a frase tem que continuar de pé sozinha.
export const TEXTOS = {
  pedirNome: "Oi! Antes de te atender, como você se chama? (só o nome, por favor — guardamos seu nome e e-mail apenas para te atender e avisar sobre shows e novidades, e você pode pedir a remoção quando quiser)",
  pedirNomeComArtista: (artista: string) =>
    `Oi! Aqui é a central do ${artista} 😊 Antes de te atender, como você se chama? (só o nome, por favor — guardamos seu nome e e-mail apenas para te atender e avisar sobre shows e novidades, e você pode pedir a remoção quando quiser)`,
  pedirEmail: "Anotado! E qual é o seu e-mail? É por ali que avisamos quando o show chega perto de você.",
  nomeInvalido: "Hmm, isso não consegui anotar como nome 😅 Pode mandar só o nome, sem mais nada?",
  emailInvalido: "Esse e-mail parece que ficou pela metade. Pode conferir e mandar de novo?",
  soTexto: "Por aqui eu leio só texto — áudio e figurinha ainda não consigo decifrar 😅 Pode escrever?",
} as const;

/**
 * `artista` vem de whatsapp_flows.artista e é opcional de propósito: número
 * sem artista cadastrado (ou automação que não é de show) recebe a versão
 * neutra, nunca uma saudação com buraco no meio.
 *
 * Só o pedido de nome muda — é a primeira mensagem, e a única em que dizer de
 * quem é a central ajuda. Repetir o nome do artista a cada campo viraria
 * assinatura de robô.
 */
export function perguntaDoCampo(campo: CampoGate, artista?: string | null): string {
  if (campo === "email") return TEXTOS.pedirEmail;
  const nome = artista?.trim();
  return nome ? TEXTOS.pedirNomeComArtista(nome) : TEXTOS.pedirNome;
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
