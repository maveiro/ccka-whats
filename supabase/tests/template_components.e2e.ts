// Validação e montagem de components de template (apps/web/lib/whatsapp-cloud/
// templateComponents.ts) — puro, sem banco.
//
// O que se testa aqui é o formato exigido pela Meta, que não é intuitivo:
// example.body_text é uma lista de UMA lista com todos os valores; botão de
// URL dinâmica leva a URL RESOLVIDA no example, não o token; cabeçalho
// aceita no máximo 1 variável; variável fora de sequência é recusada.
//
// COMO RODAR: `npm run test:db` (não usa banco).

import { montarComponentes, slugifyNomeTemplate, type TemplateFormInput } from "../../apps/web/lib/whatsapp-cloud/templateComponents.ts";

let falhas = 0;
let passou = 0;

function checar(condicao: boolean, mensagem: string): void {
  if (condicao) passou++;
  else { falhas++; console.error(`  ✗ ${mensagem}`); }
}

function cenario(nome: string, fn: () => void): void {
  const antes = falhas;
  try { fn(); } catch (err) {
    falhas++;
    console.error(`  ✗ exceção em "${nome}": ${err instanceof Error ? err.message : err}`);
  }
  console.log(`${falhas === antes ? "✓" : "✗"} ${nome}`);
}

const base: TemplateFormInput = {
  headerTexto: null,
  bodyTexto: "Olá! Seu show está chegando.",
  footerTexto: null,
  headerExemplo: null,
  bodyExemplos: [],
  botao: null,
};

cenario("corpo simples, sem variável, monta só o BODY", () => {
  const r = montarComponentes(base, null);
  checar(r.ok, r.erro ?? "");
  checar(r.components?.length === 1, `deveria ter só 1 componente, veio ${r.components?.length}`);
});

cenario("corpo vazio é recusado", () => {
  const r = montarComponentes({ ...base, bodyTexto: "   " }, null);
  checar(!r.ok, "corpo vazio deveria ser recusado");
});

cenario("corpo passando de 1024 é recusado", () => {
  const r = montarComponentes({ ...base, bodyTexto: "x".repeat(1025) }, null);
  checar(!r.ok && !!r.erro?.includes("1024"), `deveria citar o limite: ${r.erro}`);
});

cenario("corpo com variável exige exemplo na mesma quantidade", () => {
  const r = montarComponentes({ ...base, bodyTexto: "Oi {{1}}, o show é em {{2}}.", bodyExemplos: ["Ana"] }, null);
  checar(!r.ok, "deveria recusar por faltar 1 exemplo");
});

cenario("body_text vai como lista de UMA lista, na ordem — formato exato da Meta", () => {
  const r = montarComponentes(
    { ...base, bodyTexto: "Oi {{1}}, o show é em {{2}} nesta sexta.", bodyExemplos: ["Ana", "Curitiba"] },
    null,
  );
  checar(r.ok, r.erro ?? "");
  const bodyComp = (r.components as { type: string; example?: { body_text?: string[][] } }[])
    .find((c) => c.type === "BODY");
  checar(
    JSON.stringify(bodyComp?.example?.body_text) === JSON.stringify([["Ana", "Curitiba"]]),
    `formato errado: ${JSON.stringify(bodyComp?.example)}`,
  );
});

cenario("variável fora de sequência ({{1}}, {{3}}) é recusada", () => {
  const r = montarComponentes({ ...base, bodyTexto: "Oi {{1}}, código {{3}} chegou.", bodyExemplos: ["Ana", "999"] }, null);
  checar(!r.ok, "deveria recusar {{3}} sem {{2}}");
});

cenario("corpo não pode TERMINAR em variável — confirmado contra a Meta real (22/09)", () => {
  // "Seu show é dia {{1}}." foi recusado pela Graph API de verdade
  // (error_subcode 2388299): pontuação sozinha depois da variável não conta
  // como conteúdo.
  const r = montarComponentes({ ...base, bodyTexto: "Seu show é dia {{1}}.", bodyExemplos: ["19/12"] }, null);
  checar(!r.ok, "deveria recusar variável seguida só de pontuação no fim do corpo");
});

cenario("corpo com palavra de verdade depois da variável passa", () => {
  // "Seu show é dia {{1}} às 20h." foi ACEITO pela Graph API de verdade —
  // é o contraste que prova que é conteúdo, não pontuação, que conta.
  const r = montarComponentes({ ...base, bodyTexto: "Seu show é dia {{1}} às 20h.", bodyExemplos: ["19/12"] }, null);
  checar(r.ok, r.erro ?? "");
});

cenario("corpo não pode COMEÇAR em variável — confirmado contra a Meta real (22/09)", () => {
  const r = montarComponentes(
    { ...base, bodyTexto: "{{1}}, seu show está chegando!", bodyExemplos: ["Marcelo"] },
    null,
  );
  checar(!r.ok, "deveria recusar variável logo no início do corpo");
});

cenario("a mesma restrição de borda NÃO vale para o cabeçalho", () => {
  // "Olá, {{1}}!" (variável no fim) e "{{1}}, seu horário chegou" (no
  // início) foram ACEITOS pela Graph API real — só o corpo tem a regra.
  const fim = montarComponentes({ ...base, headerTexto: "Olá, {{1}}!", headerExemplo: "Marcelo" }, null);
  checar(fim.ok, `variável no fim do cabeçalho deveria passar: ${fim.erro}`);

  const inicio = montarComponentes({ ...base, headerTexto: "{{1}}, seu horário chegou", headerExemplo: "Marcelo" }, null);
  checar(inicio.ok, `variável no início do cabeçalho deveria passar: ${inicio.erro}`);
});

cenario("cabeçalho aceita no máximo 1 variável", () => {
  const r = montarComponentes({ ...base, headerTexto: "Oi {{1}}, {{2}}!", headerExemplo: "Ana" }, null);
  checar(!r.ok, "deveria recusar 2 variáveis no cabeçalho");
});

cenario("cabeçalho com variável sem exemplo é recusado", () => {
  const r = montarComponentes({ ...base, headerTexto: "Oi {{1}}!" }, null);
  checar(!r.ok, "deveria recusar sem headerExemplo");
});

cenario("cabeçalho passando de 60 é recusado", () => {
  const r = montarComponentes({ ...base, headerTexto: "x".repeat(61) }, null);
  checar(!r.ok && !!r.erro?.includes("60"), `deveria citar o limite: ${r.erro}`);
});

cenario("header_text vai como array plano — formato exato da Meta", () => {
  const r = montarComponentes({ ...base, headerTexto: "Oi {{1}}!", headerExemplo: "Ana" }, null);
  checar(r.ok, r.erro ?? "");
  const headerComp = (r.components as { type: string; example?: { header_text?: string[] } }[])
    .find((c) => c.type === "HEADER");
  checar(
    JSON.stringify(headerComp?.example?.header_text) === JSON.stringify(["Ana"]),
    `formato errado: ${JSON.stringify(headerComp?.example)}`,
  );
});

cenario("rodapé não aceita variável", () => {
  const r = montarComponentes({ ...base, footerTexto: "Válido até {{1}}" }, null);
  checar(!r.ok, "deveria recusar variável no rodapé");
});

cenario("botão rastreada sem domínio público configurado é recusado", () => {
  const r = montarComponentes({ ...base, botao: { texto: "Comprar", modo: "rastreada" } }, null);
  checar(!r.ok && !!r.erro?.includes("NEXT_PUBLIC_LINK_BASE_URL"), `deveria citar a variável: ${r.erro}`);
});

cenario("botão rastreada: URL termina em /c/{{1}}, example é a URL RESOLVIDA", () => {
  const r = montarComponentes(
    { ...base, botao: { texto: "Comprar", modo: "rastreada" } },
    "https://link.plauz.com.br",
  );
  checar(r.ok, r.erro ?? "");
  const botoes = (r.components as { type: string; buttons?: { url: string; example?: string[] }[] }[])
    .find((c) => c.type === "BUTTONS")?.buttons;
  checar(botoes?.[0]?.url === "https://link.plauz.com.br/c/{{1}}", `url errada: ${botoes?.[0]?.url}`);
  checar(
    botoes?.[0]?.example?.[0] === "https://link.plauz.com.br/c/k7Qm2xR9tA",
    `example deveria ser a URL resolvida, veio ${JSON.stringify(botoes?.[0]?.example)}`,
  );
});

cenario("botão rastreada tira barra dupla se o domínio vier com / no fim", () => {
  const r = montarComponentes(
    { ...base, botao: { texto: "Comprar", modo: "rastreada" } },
    "https://link.plauz.com.br/",
  );
  const botoes = (r.components as { type: string; buttons?: { url: string }[] }[])
    .find((c) => c.type === "BUTTONS")?.buttons;
  checar(botoes?.[0]?.url === "https://link.plauz.com.br/c/{{1}}", `barra dupla vazou: ${botoes?.[0]?.url}`);
});

cenario("botão estática com {{ é recusado (para isso existe a opção rastreada)", () => {
  const r = montarComponentes(
    { ...base, botao: { texto: "Comprar", modo: "estatica", urlEstatica: "https://x.com/{{1}}" } },
    null,
  );
  checar(!r.ok, "deveria recusar variável em URL estática");
});

cenario("botão estática com URL inválida é recusado", () => {
  const r = montarComponentes(
    { ...base, botao: { texto: "Comprar", modo: "estatica", urlEstatica: "não é url" } },
    null,
  );
  checar(!r.ok, "deveria recusar URL malformada");
});

cenario("botão estática válida monta sem example", () => {
  const r = montarComponentes(
    { ...base, botao: { texto: "Ver site", modo: "estatica", urlEstatica: "https://plauz.com.br" } },
    null,
  );
  checar(r.ok, r.erro ?? "");
  const botoes = (r.components as { type: string; buttons?: { example?: unknown } [] }[])
    .find((c) => c.type === "BUTTONS")?.buttons;
  checar(botoes?.[0]?.example === undefined, "URL estática não deveria ter example");
});

cenario("botão resposta rápida: só o texto, sem URL nem example", () => {
  const r = montarComponentes({ ...base, botao: { texto: "Vou sim!", modo: "quick_reply" } }, null);
  checar(r.ok, r.erro ?? "");
  const botoes = (r.components as { type: string; buttons?: Record<string, unknown>[] }[])
    .find((c) => c.type === "BUTTONS")?.buttons;
  checar(
    JSON.stringify(botoes?.[0]) === JSON.stringify({ type: "QUICK_REPLY", text: "Vou sim!" }),
    `formato errado: ${JSON.stringify(botoes?.[0])}`,
  );
});

cenario("botão de Flow sem flowId/navigateScreen é recusado", () => {
  const r = montarComponentes({ ...base, botao: { texto: "Ver agenda", modo: "flow" } }, null);
  checar(!r.ok, "deveria recusar sem flowId/navigateScreen");
});

cenario("botão de Flow: monta flow_action navigate com o flow_id e a tela — formato confirmado contra a Meta real", () => {
  // Testado ao vivo em 22/09/2026 contra a WABA do IB (status PENDING) e
  // removido em seguida — a Meta aceitou este formato exato.
  const r = montarComponentes(
    { ...base, botao: { texto: "Ver agenda", modo: "flow", flowId: "2344396869431043", navigateScreen: "APRESENTACAO" } },
    null,
  );
  checar(r.ok, r.erro ?? "");
  const botoes = (r.components as { type: string; buttons?: Record<string, unknown>[] }[])
    .find((c) => c.type === "BUTTONS")?.buttons;
  checar(
    JSON.stringify(botoes?.[0]) === JSON.stringify({
      type: "FLOW", text: "Ver agenda", flow_id: "2344396869431043",
      flow_action: "navigate", navigate_screen: "APRESENTACAO",
    }),
    `formato errado: ${JSON.stringify(botoes?.[0])}`,
  );
});

cenario("slugify: título vira name só com minúsculo, dígito e underscore", () => {
  checar(slugifyNomeTemplate("Vendas Abertas — Natal!") === "vendas_abertas_natal", slugifyNomeTemplate("Vendas Abertas — Natal!"));
  checar(slugifyNomeTemplate("Índio Behn 2ª turnê") === "indio_behn_2_turne", slugifyNomeTemplate("Índio Behn 2ª turnê"));
});

cenario("slugify: título só com símbolo vira string vazia (a rota recusa)", () => {
  checar(slugifyNomeTemplate("!!!") === "", slugifyNomeTemplate("!!!"));
});

console.log(`\n${passou} asserções passaram, ${falhas} falharam`);
if (falhas > 0) Deno.exit(1);
