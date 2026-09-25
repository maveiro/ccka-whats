// Mídia de cabeçalho de campanha (IMAGE/VIDEO/DOCUMENT), enviada por LINK.
//
// A Meta baixa a URL no momento do envio. Se ela não for pública, estável e do
// tipo/tamanho certo, a recusa só aparece depois, no `error` de cada
// destinatário — com a campanha já criada. Por isso a URL é sondada na criação.
//
// Limites da Cloud API: imagem JPEG/PNG até 5MB; vídeo MP4/3GPP até 16MB;
// documento até 100MB.

export type FormatoMidiaCabecalho = "IMAGE" | "VIDEO" | "DOCUMENT";

interface Regra {
  tipos: string[];
  maxBytes: number;
  rotulo: string;
}

const MB = 1024 * 1024;

export const REGRAS_MIDIA: Record<FormatoMidiaCabecalho, Regra> = {
  IMAGE: { tipos: ["image/jpeg", "image/png"], maxBytes: 5 * MB, rotulo: "imagem JPEG ou PNG de até 5 MB" },
  VIDEO: { tipos: ["video/mp4", "video/3gpp"], maxBytes: 16 * MB, rotulo: "vídeo MP4 ou 3GPP de até 16 MB" },
  DOCUMENT: {
    tipos: [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "text/plain",
    ],
    maxBytes: 100 * MB,
    rotulo: "documento (PDF, Office ou TXT) de até 100 MB",
  },
};

export function formatoDeMidia(valor: unknown): FormatoMidiaCabecalho | null {
  return valor === "IMAGE" || valor === "VIDEO" || valor === "DOCUMENT" ? valor : null;
}

/** Host que não deve ser buscado pelo servidor (SSRF): loopback, rede privada, link-local. */
export function hostInterno(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (h === "::1" || h === "::" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80") || h.startsWith("::ffff:")) {
    return h.includes(":");
  }
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  // Sem ponto = nome de rede interna (ex.: "metadata").
  return !h.includes(".") && !h.includes(":");
}

/** Validação sem rede: só https, com host público. Devolve a mensagem de erro ou null. */
export function validarUrlMidia(url: unknown): string | null {
  if (typeof url !== "string" || !url.trim()) return "Informe a URL da mídia do cabeçalho.";
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return "A URL da mídia não é válida.";
  }
  if (u.protocol !== "https:") return "A URL da mídia precisa ser https.";
  if (u.username || u.password) return "A URL da mídia não pode conter usuário e senha.";
  if (hostInterno(u.hostname)) return "A URL da mídia precisa apontar para um endereço público.";
  return null;
}

/**
 * Confere tipo e tamanho a partir dos cabeçalhos da resposta. Puro, para teste.
 * `contentLength` nulo (servidor não informa) passa: a Meta é quem baixa, e
 * recusar por falta do cabeçalho barraria hospedagens legítimas.
 */
export function conferirMidia(
  formato: FormatoMidiaCabecalho,
  contentType: string | null,
  contentLength: number | null,
): string | null {
  const regra = REGRAS_MIDIA[formato];
  const tipo = (contentType ?? "").split(";")[0].trim().toLowerCase();
  if (!regra.tipos.includes(tipo)) {
    return `O link devolveu "${tipo || "tipo desconhecido"}", mas este template pede ${regra.rotulo}.`;
  }
  if (contentLength !== null && contentLength > regra.maxBytes) {
    return `O arquivo tem ${(contentLength / MB).toFixed(1)} MB; o limite é ${regra.rotulo}.`;
  }
  return null;
}

/** Sonda a URL (HEAD, com GET de 1 byte como reserva) e devolve o erro legível, ou null se servir. */
export async function sondarMidia(formato: FormatoMidiaCabecalho, url: string): Promise<string | null> {
  const invalida = validarUrlMidia(url);
  if (invalida) return invalida;

  const pedir = async (method: "HEAD" | "GET") =>
    fetch(url.trim(), {
      method,
      // Sem seguir redirect: a Meta também não segue, e um redirect é o
      // caminho clássico para fugir da checagem de host.
      redirect: "manual",
      headers: method === "GET" ? { Range: "bytes=0-0" } : undefined,
      signal: AbortSignal.timeout(8000),
    });

  try {
    let res = await pedir("HEAD");
    if (res.status === 405 || res.status === 403 || res.status === 501) res = await pedir("GET");
    if (res.status >= 300 && res.status < 400) {
      return "O link redireciona para outro endereço; a Meta não segue redirecionamento. Use a URL final do arquivo.";
    }
    if (!res.ok) return `O link respondeu ${res.status}; a Meta não conseguiria baixar a mídia.`;

    // Em resposta parcial (206) o tamanho total vem em Content-Range.
    const range = res.headers.get("content-range")?.match(/\/(\d+)$/);
    const len = range ? Number(range[1]) : res.headers.get("content-length");
    const tamanho = len === null || len === undefined || len === "" ? null : Number(len);
    return conferirMidia(formato, res.headers.get("content-type"), Number.isFinite(tamanho) ? tamanho : null);
  } catch {
    return "Não foi possível acessar o link da mídia (tempo esgotado ou endereço inacessível).";
  }
}
