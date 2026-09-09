// Criptografia do endpoint de WhatsApp Flows (Sprint B1 do PRD
// docs/prd/prd-automacao-flows-whatsapp.md — spike isolado, feito antes de
// qualquer outra coisa da Trilha B porque "não é mais uma rota, é capacidade
// nova").
//
// Protocolo (docs da Meta, "Implement endpoints for Flows"):
//   requisição: { encrypted_flow_data, encrypted_aes_key, initial_vector }, base64
//   1. encrypted_aes_key  -> RSA-OAEP(SHA-256, MGF1-SHA256) com a chave PRIVADA
//                            do negócio -> chave AES de 128 bits
//   2. encrypted_flow_data -> AES-128-GCM com essa chave e o initial_vector;
//                            os últimos 16 bytes são a tag de autenticação
//   3. resposta: AES-GCM com a MESMA chave e o IV INVERTIDO (XOR 0xFF byte a
//                byte), tag de 16 bytes anexada, base64 como texto puro
//
// Web Crypto já espera/produz a tag anexada ao ciphertext, que é exatamente o
// formato da Meta — por isso não há fatiamento manual de tag aqui.

const TAG_BITS = 128; // 16 bytes

export interface RequisicaoCriptografada {
  encrypted_flow_data: string;
  encrypted_aes_key: string;
  initial_vector: string;
}

export interface RequisicaoAberta {
  corpo: Record<string, unknown>;
  chaveAes: CryptoKey;
  iv: Uint8Array<ArrayBuffer>;
}

// Uint8Array<ArrayBuffer> explícito (não ArrayBufferLike): Web Crypto exige
// BufferSource sobre ArrayBuffer, e o genérico padrão do TS 5.7 inclui
// SharedArrayBuffer, que `deno check` recusa.
function base64ParaBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const bytes = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesParaBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** PEM (PKCS#8) -> CryptoKey RSA-OAEP para decifrar a chave AES. */
export async function importarChavePrivada(pem: string): Promise<CryptoKey> {
  const corpo = pem
    .replace(/-----BEGIN [A-Z ]+-----/g, "")
    .replace(/-----END [A-Z ]+-----/g, "")
    .replace(/\s+/g, "");

  if (!corpo) throw new Error("chave privada vazia");

  return await crypto.subtle.importKey(
    "pkcs8",
    base64ParaBytes(corpo),
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["decrypt"],
  );
}

/**
 * Abre a requisição. Lança se qualquer etapa falhar — quem chama deve
 * responder HTTP 421 nesse caso (exigência da Meta: 421 significa "não
 * consegui descriptografar", e faz o cliente reabrir o Flow com chave nova).
 */
export class ErroDeAbertura extends Error {
  constructor(readonly etapa: "rsa" | "aes" | "json", readonly detalhe: string, readonly medidas: Record<string, number>) {
    super(`falha na etapa ${etapa}: ${detalhe}`);
    this.name = "ErroDeAbertura";
  }
}

export async function abrirRequisicao(
  requisicao: RequisicaoCriptografada,
  chavePrivada: CryptoKey,
): Promise<RequisicaoAberta> {
  // Tamanhos ajudam a distinguir "chave errada" de "formato diferente do
  // esperado": com RSA-2048 a chave AES cifrada tem exatamente 256 bytes, e o
  // IV do WhatsApp Flows tem 16.
  const medidas = {
    bytes_chave_aes: base64ParaBytes(requisicao.encrypted_aes_key).length,
    bytes_iv: base64ParaBytes(requisicao.initial_vector).length,
    bytes_dados: base64ParaBytes(requisicao.encrypted_flow_data).length,
  };

  let chaveAesBytes: Uint8Array<ArrayBuffer>;
  try {
    chaveAesBytes = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: "RSA-OAEP" },
        chavePrivada,
        base64ParaBytes(requisicao.encrypted_aes_key),
      ),
    );
  } catch (err) {
    throw new ErroDeAbertura("rsa", err instanceof Error ? err.message : String(err), medidas);
  }

  const chaveAes = await crypto.subtle.importKey(
    "raw",
    chaveAesBytes,
    { name: "AES-GCM" },
    false,
    ["decrypt", "encrypt"],
  );

  const iv = base64ParaBytes(requisicao.initial_vector);

  let claro: ArrayBuffer;
  try {
    claro = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, tagLength: TAG_BITS },
      chaveAes,
      base64ParaBytes(requisicao.encrypted_flow_data),
    );
  } catch (err) {
    throw new ErroDeAbertura(
      "aes",
      err instanceof Error ? err.message : String(err),
      { ...medidas, bytes_chave_aes_aberta: chaveAesBytes.length },
    );
  }

  const texto = new TextDecoder().decode(claro);
  try {
    return { corpo: JSON.parse(texto) as Record<string, unknown>, chaveAes, iv };
  } catch (err) {
    throw new ErroDeAbertura("json", err instanceof Error ? err.message : String(err), medidas);
  }
}

/**
 * Fecha a resposta com a mesma chave AES e o IV invertido.
 *
 * O flip do IV não é detalhe de estilo: reusar (chave, IV) para cifrar duas
 * mensagens diferentes quebra o GCM por completo — vaza o hash key e permite
 * forjar tags. A Meta resolve isso definindo que a resposta usa o complemento
 * de 1 do IV da requisição.
 */
export async function fecharResposta(
  resposta: unknown,
  chaveAes: CryptoKey,
  iv: Uint8Array<ArrayBuffer>,
): Promise<string> {
  const ivInvertido = new Uint8Array(new ArrayBuffer(iv.length));
  for (let i = 0; i < iv.length; i++) ivInvertido[i] = iv[i] ^ 0xff;

  const cifrado = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: ivInvertido, tagLength: TAG_BITS },
    chaveAes,
    new TextEncoder().encode(JSON.stringify(resposta)),
  );

  return bytesParaBase64(new Uint8Array(cifrado));
}

export const _internos = { base64ParaBytes, bytesParaBase64 };
