// Leitura de dimensões de imagem sem biblioteca (agenda-sync/imagem.ts).
//
// Existe porque a proporção real da arte é o que faz a tela do fã enquadrar
// certo: com `scale-type: contain`, o Flow precisa do `aspect-ratio`, e errar
// a leitura significa arte esticada ou com sobra no aparelho.
//
// COMO RODAR: `npm run test:db` (não usa banco, mas segue a suíte).

import { dimensoesDaImagem } from "../functions/agenda-sync/imagem.ts";

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

/** PNG mínimo válido: assinatura + IHDR com as dimensões pedidas. */
function png(largura: number, altura: number): Uint8Array {
  const b = new Uint8Array(24);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const v = new DataView(b.buffer);
  v.setUint32(8, 13);
  b.set([0x49, 0x48, 0x44, 0x52], 12);
  v.setUint32(16, largura);
  v.setUint32(20, altura);
  return b;
}

/**
 * JPEG com um segmento APP1 (EXIF) antes do SOF0 — é exatamente o que o
 * arquivo real do Monday tem (`ffd8ffe1`), e o motivo de o parser precisar
 * percorrer os segmentos em vez de ler um offset fixo.
 */
function jpegComExif(largura: number, altura: number): Uint8Array {
  const exif = 40;
  const b = new Uint8Array(4 + exif + 12);
  const v = new DataView(b.buffer);
  b.set([0xff, 0xd8], 0);          // SOI
  b.set([0xff, 0xe1], 2);          // APP1
  v.setUint16(4, exif);            // comprimento do APP1
  const sof = 2 + 2 + exif;
  b.set([0xff, 0xc0], sof);        // SOF0
  v.setUint16(sof + 2, 11);        // comprimento
  b[sof + 4] = 8;                  // precisão
  v.setUint16(sof + 5, altura);
  v.setUint16(sof + 7, largura);
  return b;
}

cenario("PNG: lê do IHDR", () => {
  checar(
    JSON.stringify(dimensoesDaImagem(png(1080, 1080))) === JSON.stringify({ largura: 1080, altura: 1080 }),
    "PNG quadrado deveria medir 1080x1080",
  );
});

cenario("JPEG com EXIF antes do SOF: percorre os segmentos", () => {
  const d = dimensoesDaImagem(jpegComExif(1080, 461));
  checar(d?.largura === 1080 && d?.altura === 461, `veio ${JSON.stringify(d)}`);
  // A proporção é o que vai para o aspect-ratio da tela.
  checar(Math.round((1080 / 461) * 100) / 100 === 2.34, "proporção do banner real deveria ser 2.34");
});

cenario("JPEG vertical e quadrado: altura e largura na ordem certa", () => {
  // Trocar altura por largura é o erro clássico do SOF (a altura vem antes).
  const vertical = dimensoesDaImagem(jpegComExif(1080, 1350));
  checar(vertical?.largura === 1080 && vertical?.altura === 1350, `4:5 veio ${JSON.stringify(vertical)}`);
  const quadrada = dimensoesDaImagem(jpegComExif(800, 800));
  checar(quadrada?.largura === 800 && quadrada?.altura === 800, "quadrada deveria ser 800x800");
});

cenario("lixo não quebra, devolve null", () => {
  checar(dimensoesDaImagem(new Uint8Array([1, 2, 3])) === null, "bytes aleatórios");
  checar(dimensoesDaImagem(new Uint8Array(0)) === null, "vazio");
  // PDF anexado na coluna de arte por engano: assinatura %PDF.
  checar(dimensoesDaImagem(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])) === null, "PDF");
});

console.log(`\n${passou} asserções passaram, ${falhas} falharam`);
Deno.exit(falhas === 0 ? 0 : 1);
