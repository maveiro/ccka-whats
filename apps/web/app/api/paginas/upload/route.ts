import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { autorizarPagina } from "@/lib/paginas-auth";

// Upload de imagem da página pública (avatar, arte de botão, fundo).
//
// Vai para o bucket `paginas`, que é PÚBLICO: é material de divulgação,
// servido por CDN para manter a página rápida. Diferente do bucket `media`
// (conversa de WhatsApp), que é privado por natureza.
//
// O upload passa pelo servidor (service role) em vez de ir direto do browser:
// é o que permite validar tipo e tamanho antes de o arquivo existir, e não
// exige policy de storage para authenticated.

const TIPOS = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);
const TETO_BYTES = 5 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const auth = await autorizarPagina();
  if ("erro" in auth) return auth.erro;

  const form = await req.formData().catch(() => null);
  const arquivo = form?.get("file");
  if (!(arquivo instanceof File)) {
    return NextResponse.json({ error: "Nenhum arquivo enviado" }, { status: 400 });
  }

  const extensao = TIPOS.get(arquivo.type);
  if (!extensao) {
    return NextResponse.json({ error: "Use JPEG, PNG ou WebP" }, { status: 400 });
  }
  if (arquivo.size > TETO_BYTES) {
    return NextResponse.json(
      { error: `Imagem tem ${Math.round(arquivo.size / 1024 / 1024)}MB (limite 5MB)` },
      { status: 400 },
    );
  }

  // Caminho por tenant e nome aleatório: nome original poderia colidir entre
  // páginas e revelar o que o artista chamou o arquivo.
  const caminho = `${auth.tenantId}/${crypto.randomUUID()}.${extensao}`;

  const { error } = await createAdminClient().storage
    .from("paginas")
    .upload(caminho, new Uint8Array(await arquivo.arrayBuffer()), {
      contentType: arquivo.type,
      upsert: false,
    });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ path: caminho }, { status: 201 });
}
