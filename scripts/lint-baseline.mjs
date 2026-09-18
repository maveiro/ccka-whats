#!/usr/bin/env node
// Linha de base do ESLint.
//
// O repo tem 8 erros de lint herdados (seis do mesmo
// `react-hooks/set-state-in-effect`, em componentes que estão em produção e
// funcionando). Corrigi-los de verdade significa refatorar como esses
// componentes buscam dados — risco real por ganho de organização.
//
// Enquanto isso não acontece, o CI trava o que importa: **o nono erro**. A
// base só pode DESCER (quando alguém corrige algo, o script avisa para
// atualizar o número), nunca subir.
//
// Uso: node scripts/lint-baseline.mjs [--atualizar]

import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const ARQUIVO = new URL("../.eslint-baseline.json", import.meta.url);
const base = JSON.parse(readFileSync(ARQUIVO, "utf8"));

// O eslint sai com código 1 quando há QUALQUER erro — que é o estado normal
// enquanto a linha de base for maior que zero. Então o código de saída não
// interessa, só o JSON: sem este try/catch o script morre justamente no caso
// que ele existe para medir.
let saida;
try {
  saida = execFileSync("npx", ["eslint", ".", "-f", "json"], {
    cwd: new URL("../apps/web", import.meta.url).pathname,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });
} catch (err) {
  saida = err.stdout;
  if (!saida) {
    console.error("não consegui rodar o eslint:", err.message);
    process.exit(2);
  }
}

const resultado = JSON.parse(saida);
const erros = resultado.flatMap((f) =>
  f.messages.filter((m) => m.severity === 2).map((m) => ({
    arquivo: f.filePath.split("/apps/web/").pop(),
    linha: m.line,
    regra: m.ruleId,
  })),
);

if (process.argv.includes("--atualizar")) {
  writeFileSync(ARQUIVO, `${JSON.stringify({ erros: erros.length, atualizado_em: new Date().toISOString().slice(0, 10) }, null, 2)}\n`);
  console.log(`linha de base atualizada para ${erros.length}`);
  process.exit(0);
}

console.log(`erros de lint: ${erros.length} (linha de base: ${base.erros})`);

if (erros.length > base.erros) {
  console.error(`\n✗ ${erros.length - base.erros} erro(s) NOVO(S) de lint. A lista completa:`);
  for (const e of erros) console.error(`  ${e.arquivo}:${e.linha}  ${e.regra}`);
  console.error("\nCorrija o novo erro. A linha de base existe para a dívida antiga, não para acomodar dívida nova.");
  process.exit(1);
}

if (erros.length < base.erros) {
  console.log(`\n✓ ${base.erros - erros.length} erro(s) a menos que a base. Rode 'node scripts/lint-baseline.mjs --atualizar' e commite o novo número.`);
}

process.exit(0);
