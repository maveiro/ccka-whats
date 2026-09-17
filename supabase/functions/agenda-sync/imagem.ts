// Dimensões de uma imagem, lidas do cabeçalho — sem biblioteca.
//
// Por que precisamos: o componente `Image` do Flow renderiza dentro de um
// container, e a doc da Meta recomenda informar `aspect-ratio` quando o
// `scale-type` é `contain` (senão sobra espaço no Android). Mandando a
// proporção real de cada arte, qualquer formato — banner 2.34:1, quadrada,
// vertical — renderiza certo sem republicar o Flow.

export interface Dimensoes {
  largura: number;
  altura: number;
}

/** Marcadores SOF do JPEG (o que carrega altura/largura). */
const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

export function dimensoesDaImagem(bytes: Uint8Array): Dimensoes | null {
  return dimensoesPng(bytes) ?? dimensoesJpeg(bytes);
}

/** PNG: IHDR é sempre o primeiro chunk, largura e altura em big-endian. */
function dimensoesPng(b: Uint8Array): Dimensoes | null {
  const assinatura = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length < 24 || !assinatura.every((v, i) => b[i] === v)) return null;
  const vista = new DataView(b.buffer, b.byteOffset);
  return { largura: vista.getUint32(16), altura: vista.getUint32(20) };
}

/**
 * JPEG: percorre os segmentos até achar um SOF.
 *
 * Não dá para assumir posição fixa: o arquivo real do Monday vem com EXIF
 * (`ffd8ffe1`) antes do SOF, então ler um offset fixo devolveria lixo.
 */
function dimensoesJpeg(b: Uint8Array): Dimensoes | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  const vista = new DataView(b.buffer, b.byteOffset);

  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const marcador = b[i + 1];

    if (SOF.has(marcador)) {
      return { largura: vista.getUint16(i + 7), altura: vista.getUint16(i + 5) };
    }
    // SOI/EOI e os RSTn não têm comprimento; o resto tem.
    if (marcador === 0xd8 || marcador === 0xd9 || (marcador >= 0xd0 && marcador <= 0xd7)) {
      i += 2;
      continue;
    }
    const comprimento = vista.getUint16(i + 2);
    if (comprimento <= 0) return null;
    i += 2 + comprimento;
  }
  return null;
}
