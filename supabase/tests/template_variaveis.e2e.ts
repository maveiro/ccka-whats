// Onde cada coluna do CSV entra no template (campaign-sender/variaveis.ts).
//
// Regra pequena, falha total: errar aqui não estraga UMA mensagem — a Graph
// API recusa todas com o mesmo 400 e a campanha morre sem entregar nada. Foi
// o que aconteceu em 18/09/2026 com um template cuja variável estava no
// cabeçalho ("Olá, {{1}}") enquanto o disparador mandava tudo como corpo.
//
// COMO RODAR: `npm run test:db` (não usa banco).

import { dividirVariaveis, planoDeVariaveis } from "../functions/campaign-sender/variaveis.ts";

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

// O template real que quebrou, como a Graph API o devolve.
const NATAL_POA = [
  { type: "HEADER", format: "TEXT", text: "Olá, {{1}}. Você tem um horário com a Dra Rosângela!" },
  { type: "BODY", text: "🎄 *VENDAS ABERTAS*!\nO show está chegando." },
  { type: "FOOTER", text: "Plauz Produções" },
  { type: "BUTTONS", buttons: [{ type: "URL", text: "Comprar", url: "https://exemplo.invalido/e" }] },
];

cenario("variável do cabeçalho vai para o cabeçalho, não para o corpo", () => {
  const plano = planoDeVariaveis(NATAL_POA);
  checar(plano.header === 1, `cabeçalho deveria pedir 1, veio ${plano.header}`);
  checar(plano.body === 0, `corpo deveria pedir 0, veio ${plano.body}`);

  const { header, body } = dividirVariaveis({ "1": "Marcelo" }, plano);
  checar(header.length === 1 && header[0] === "Marcelo", `cabeçalho: ${JSON.stringify(header)}`);
  checar(body.length === 0, `corpo deveria ficar vazio: ${JSON.stringify(body)}`);
});

cenario("template só com corpo continua como sempre", () => {
  const plano = planoDeVariaveis([{ type: "BODY", text: "Oi {{1}}, o show em {{2}} está chegando." }]);
  checar(plano.header === 0 && plano.body === 2, JSON.stringify(plano));

  const { header, body } = dividirVariaveis({ "1": "Ana", "2": "Curitiba" }, plano);
  checar(header.length === 0, `sem cabeçalho não se manda componente: ${JSON.stringify(header)}`);
  checar(body.join("|") === "Ana|Curitiba", `ordem do corpo: ${JSON.stringify(body)}`);
});

cenario("cabeçalho E corpo: cabeçalho primeiro, corpo depois", () => {
  // Os dois numeram seus placeholders do 1, então não dá para deduzir o
  // destino pelo número — é a posição no CSV que decide, cabeçalho na frente.
  const plano = planoDeVariaveis([
    { type: "HEADER", format: "TEXT", text: "Olá, {{1}}" },
    { type: "BODY", text: "Seu show em {{1}} é dia {{2}}." },
  ]);
  checar(plano.header === 1 && plano.body === 2, JSON.stringify(plano));

  const { header, body } = dividirVariaveis({ "1": "Ana", "2": "Curitiba", "3": "19/12" }, plano);
  checar(header.join("|") === "Ana", `cabeçalho: ${JSON.stringify(header)}`);
  checar(body.join("|") === "Curitiba|19/12", `corpo: ${JSON.stringify(body)}`);
});

cenario("placeholder repetido conta uma vez só", () => {
  // A Meta conta parâmetros DISTINTOS: repetir {{1}} no texto não pede outro.
  const plano = planoDeVariaveis([{ type: "BODY", text: "{{1}}, é isso mesmo, {{1}}?" }]);
  checar(plano.body === 1, `deveria pedir 1, veio ${plano.body}`);
});

cenario("cabeçalho de mídia é sinalizado, não contado como texto", () => {
  const plano = planoDeVariaveis([
    { type: "HEADER", format: "IMAGE" },
    { type: "BODY", text: "Oi {{1}}" },
  ]);
  checar(plano.headerMidia === "IMAGE", `deveria sinalizar a mídia: ${JSON.stringify(plano)}`);
  checar(plano.header === 0, "cabeçalho de mídia não pede variável de texto");
});

cenario("template sem variável nenhuma não monta componente", () => {
  const plano = planoDeVariaveis([{ type: "BODY", text: "Mensagem fixa." }]);
  const { header, body } = dividirVariaveis({}, plano);
  checar(header.length === 0 && body.length === 0, "nada a mandar");
});

cenario("components ausente não explode", () => {
  const plano = planoDeVariaveis(null);
  checar(plano.header === 0 && plano.body === 0 && plano.headerMidia === null, JSON.stringify(plano));
});

console.log(`\n${passou} asserções passaram, ${falhas} falharam`);
if (falhas > 0) Deno.exit(1);
