// Regras do card de show na página pública (apps/web/lib/show-card.ts).
//
// É regra de negócio, não formatação: o que o botão DIZ muda o que a pessoa
// espera achar do outro lado. Mandar alguém para uma página de compra de um
// show esgotado, ou mostrar "Lista de espera" sem ter onde captar, são os dois
// jeitos de o card mentir.
//
// COMO RODAR: `npm run test:db` (não usa banco).

import { acaoDoShow, dataDoCard, periodoDerivado, selosDoShow } from "../../apps/web/lib/show-card.ts";

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

const base = { label_ingressos: null, label_periodo: null, data_show: null };
const ESPERA = "https://exemplo.invalido/lista-de-espera";

cenario("show vendendo com link: Ver ingressos", () => {
  const a = acaoDoShow({ ...base, status_venda: "à venda", link_compra: "https://x.invalido/1" });
  checar(a.tipo === "ingressos" && a.rotulo === "Ver ingressos", JSON.stringify(a));
});

cenario("confirmado que ainda não vende: Lista de espera", () => {
  const a = acaoDoShow({ ...base, status_venda: "confirmado", link_compra: null }, ESPERA);
  checar(a.tipo === "lista_espera" && a.rotulo === "Lista de espera", JSON.stringify(a));
});

cenario("confirmado COM link de compra ainda é lista de espera", () => {
  // O status manda: "confirmado" quer dizer que a venda não abriu, mesmo que
  // já exista uma URL cadastrada (link posto antes da abertura das vendas é
  // comum).
  const a = acaoDoShow({ ...base, status_venda: "Confirmado", link_compra: "https://x.invalido/1" }, ESPERA);
  checar(a.tipo === "lista_espera", JSON.stringify(a));
});

cenario("esgotado ganha de tudo, e não leva a página de compra", () => {
  const a = acaoDoShow({ ...base, status_venda: "esgotado", link_compra: "https://x.invalido/1" }, ESPERA);
  checar(a.tipo === "esgotado" && a.rotulo === "Esgotado", JSON.stringify(a));
});

cenario("sem link e sem lista de espera: nenhum botão", () => {
  // Botão que não leva a nada é pior que ausência de botão.
  const a = acaoDoShow({ ...base, status_venda: "confirmado", link_compra: null });
  checar(a.tipo === "sem_acao", JSON.stringify(a));
});

cenario("período é derivado da data, não do rótulo do board", () => {
  const agora = new Date("2026-09-17T15:00:00-03:00");
  checar(periodoDerivado("2026-09-17T21:00:00-03:00", agora) === "Hoje", "hoje");
  checar(periodoDerivado("2026-09-18T21:00:00-03:00", agora) === "Amanhã", "amanhã");
  // 19/09/2026 é sábado.
  checar(periodoDerivado("2026-09-19T21:00:00-03:00", agora) === "Neste fim de semana", "sábado desta semana");
  // 22/09 é terça: a 5 dias, mas não é fim de semana.
  checar(periodoDerivado("2026-09-22T21:00:00-03:00", agora) === null, "terça não é fim de semana");
  // Sábado da semana seguinte (26/09) está a 9 dias.
  checar(periodoDerivado("2026-09-26T21:00:00-03:00", agora) === null, "sábado da semana seguinte não conta");
});

cenario("rótulo de período do board não duplica o derivado", () => {
  // O board tem "Amanhã" como dropdown mantido à mão — se repetisse o
  // derivado, o card mostraria o mesmo chip duas vezes.
  const agora = new Date("2026-09-17T15:00:00-03:00");
  const selos = selosDoShow({
    ...base, status_venda: "à venda", link_compra: "x",
    data_show: "2026-09-18T21:00:00-03:00", label_periodo: "Amanhã",
  }, agora);
  checar(selos.filter((s) => s.toLowerCase() === "amanhã").length === 1, JSON.stringify(selos));
});

cenario("selos: confirmado e label do board aparecem, 'à venda' não", () => {
  const agora = new Date("2026-09-17T15:00:00-03:00");

  const vendendo = selosDoShow({
    ...base, status_venda: "à venda", link_compra: "x",
    data_show: "2026-10-30T21:00:00-03:00", label_ingressos: "Em Alta",
  }, agora);
  // "à venda" é o que o botão já diz; repetir num chip é ruído.
  checar(!vendendo.some((s) => s.includes("venda")), JSON.stringify(vendendo));
  checar(vendendo.includes("Em Alta"), "selo do board deveria aparecer");

  const confirmado = selosDoShow({
    ...base, status_venda: "confirmado", link_compra: null,
    data_show: "2026-10-30T21:00:00-03:00",
  }, agora);
  checar(confirmado.includes("Confirmado"), "confirmado é informação nova, tem de virar chip");
});

cenario("bloco de data: mês, dia, semana e hora em Brasília", () => {
  const d = dataDoCard("2026-09-18T21:00:00-03:00");
  checar(d?.dia === "18", `dia ${d?.dia}`);
  checar(d?.mes === "set", `mês ${d?.mes}`);
  checar(d?.semana === "sex", `semana ${d?.semana}`);
  checar(d?.hora === "21:00", `hora ${d?.hora}`);
});

cenario("meia-noite exata é 'hora não informada'", () => {
  // Mesma convenção do Flow: o sync grava meia-noite quando o board não tem
  // hora, e mostrar "00:00" para um show de noite é pior que não mostrar.
  const d = dataDoCard("2026-09-18T00:00:00-03:00");
  checar(d?.hora === "", `deveria ser vazio, veio "${d?.hora}"`);
  checar(d?.dia === "18", "a data continua aparecendo");
});

console.log(`\n${passou} asserções passaram, ${falhas} falharam`);
Deno.exit(falhas === 0 ? 0 : 1);
