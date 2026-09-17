#!/usr/bin/env -S deno run -A
// Republica um Flow da Meta a partir do JSON de referência do repo.
//
// Existe porque Flow publicado é IMUTÁVEL (doc da Meta: "This Flow cannot be
// deleted or updated afterwards"): toda mudança de tela significa criar um
// Flow novo, publicar, apontar whatsapp_flows.meta_flow_id para ele e
// descontinuar o antigo. Feito à mão duas vezes em 17/09/2026; as arestas que
// este script guarda:
//
//  - as chaves `_*` do arquivo (comentários) são RECUSADAS pela Graph API
//    (INVALID_PROPERTY_KEY) — sobem removidas;
//  - validação vem no upload do asset, e publicar sem olhar `validation_errors`
//    publica um Flow quebrado;
//  - o endpoint_uri tem que ser o mesmo do Flow atual, senão o Flow novo não
//    sabe com quem falar;
//  - descontinuar é IRREVERSÍVEL e bloqueia abrir os balões já enviados, então
//    é passo separado, nunca automático.
//
// USO:
//   deno run -A scripts/republicar-flow.ts --json docs/flows/central_de_shows.flow.json \
//     --flow-atual 1600957048078093 --nome "Central de shows — Índio Behn (v3)"
//
// Depois de publicar, o script imprime o que falta: o UPDATE do meta_flow_id
// e o comando de deprecate.

const GRAPH = "https://graph.facebook.com/v23.0";

function arg(nome: string): string | undefined {
  const i = Deno.args.indexOf(`--${nome}`);
  return i >= 0 ? Deno.args[i + 1] : undefined;
}

const caminhoJson = arg("json");
const flowAtual = arg("flow-atual");
const nome = arg("nome");
const token = Deno.env.get("META_TOKEN");
const waba = Deno.env.get("META_WABA_ID");

if (!caminhoJson || !flowAtual || !nome || !token || !waba) {
  console.error(`Faltam argumentos.
  --json         arquivo do Flow JSON no repo
  --flow-atual   id do Flow publicado hoje (de onde herda o endpoint_uri)
  --nome         nome do Flow novo na Meta
  env META_TOKEN e META_WABA_ID`);
  Deno.exit(2);
}

// 1. endpoint_uri e categorias do Flow atual — herdar em vez de digitar.
const atual = await (await fetch(
  `${GRAPH}/${flowAtual}?fields=id,name,status,categories,endpoint_uri`,
  { headers: { Authorization: `Bearer ${token}` } },
)).json();

if (!atual.endpoint_uri) {
  console.error("Não consegui ler o Flow atual:", JSON.stringify(atual));
  Deno.exit(1);
}
console.log(`Flow atual: ${atual.id} (${atual.status}) — ${atual.name}`);
console.log(`  endpoint: ${atual.endpoint_uri}`);

// 2. JSON sem as chaves de comentário.
const bruto = JSON.parse(await Deno.readTextFile(caminhoJson)) as Record<string, unknown>;
const limpo = Object.fromEntries(Object.entries(bruto).filter(([k]) => !k.startsWith("_")));
console.log(`  JSON: ${Object.keys(bruto).length - Object.keys(limpo).length} chave(s) de comentário removida(s)`);

// 3. Cria o Flow novo.
const criado = await (await fetch(`${GRAPH}/${waba}/flows`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    name: nome,
    categories: atual.categories ?? ["OTHER"],
    endpoint_uri: atual.endpoint_uri,
  }),
})).json();

if (!criado.id) {
  console.error("Falhou ao criar:", JSON.stringify(criado));
  Deno.exit(1);
}
console.log(`\nFlow novo: ${criado.id} (DRAFT)`);

// 4. Sobe o JSON — é aqui que a validação acontece.
const form = new FormData();
form.append("name", "flow.json");
form.append("asset_type", "FLOW_JSON");
form.append("file", new Blob([JSON.stringify(limpo)], { type: "application/json" }), "flow.json");

const upload = await (await fetch(`${GRAPH}/${criado.id}/assets`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}` },
  body: form,
})).json();

const erros = upload.validation_errors ?? [];
if (erros.length > 0) {
  console.error("\nJSON recusado — Flow novo fica em DRAFT e nada foi publicado:");
  for (const e of erros) console.error(`  ${e.error}: ${e.message} (linha ${e.line_start})`);
  Deno.exit(1);
}
console.log("  JSON aceito, sem erros de validação");

// 5. Publica.
const publicado = await (await fetch(`${GRAPH}/${criado.id}/publish`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}` },
})).json();

if (!publicado.success) {
  console.error("Falhou ao publicar:", JSON.stringify(publicado));
  Deno.exit(1);
}

const final = await (await fetch(`${GRAPH}/${criado.id}?fields=id,status,preview`, {
  headers: { Authorization: `Bearer ${token}` },
})).json();

console.log(`  publicado: ${final.status}`);
console.log(`\nPrévia: ${final.preview?.preview_url ?? "(sem prévia)"}`);
console.log(`
FALTA (nesta ordem, e o deprecate é irreversível):

  1. apontar a central para o Flow novo:
     update whatsapp_flows set meta_flow_id = '${criado.id}' where meta_flow_id = '${flowAtual}';

  2. conferir no aparelho (digitar a palavra-chave e abrir uma tela)

  3. descontinuar o antigo — bloqueia abrir os balões já enviados:
     curl -X POST '${GRAPH}/${flowAtual}/deprecate' -H "Authorization: Bearer $META_TOKEN"
`);
