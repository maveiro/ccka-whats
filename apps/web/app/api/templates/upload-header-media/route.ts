import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import {
  createUploadSession,
  GraphApiError,
  resolveAppId,
  uploadFileBytes,
} from "@/lib/whatsapp-cloud/graphClient";
import { getCloudCredentialById } from "@/lib/whatsapp-cloud/getCloudCredential";
import type { FormatoMidia } from "@/lib/whatsapp-cloud/templateComponents";

// Tipos aceitos pela Resumable Upload API para header de template (doc da
// Meta) — cada um vira um `format` diferente no componente HEADER.
const TIPOS_ACEITOS: Record<string, FormatoMidia> = {
  "image/jpeg": "IMAGE",
  "image/jpg": "IMAGE",
  "image/png": "IMAGE",
  "video/mp4": "VIDEO",
  "video/3gpp": "VIDEO",
  "application/pdf": "DOCUMENT",
};

// Tetos PRÁTICOS nossos, não necessariamente os limites exatos da Meta
// (confirmamos só IMAGE ao vivo, 22/09/2026) — evitam gastar uma sessão de
// upload inteira num arquivo claramente grande demais. A Meta segue sendo
// quem decide de verdade; um arquivo que passa aqui e ainda assim for
// grande demais para ela volta como erro normal, repassado como veio.
const TETO_BYTES: Record<FormatoMidia, number> = {
  IMAGE: 5 * 1024 * 1024,
  VIDEO: 16 * 1024 * 1024,
  DOCUMENT: 5 * 1024 * 1024,
};

// POST multipart/form-data: { credentialId, file } — sobe a mídia de exemplo
// do cabeçalho pela Resumable Upload API (graphClient.ts) e devolve o
// handle que o formulário de criação/edição usa em `headerMidia`. Fica
// separada da rota principal porque ali o corpo é JSON; aqui é binário.
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: operator } = await supabase.from("operators").select("role, tenant_id").eq("id", user.id).single();
  if (operator?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const form = await req.formData();
  const credentialId = form.get("credentialId");
  const file = form.get("file");

  if (typeof credentialId !== "string" || !credentialId) {
    return NextResponse.json({ error: "Falta a conta (WABA)" }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Falta o arquivo" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: dono } = await admin
    .from("whatsapp_cloud_credentials")
    .select("tenant_id")
    .eq("id", credentialId)
    .maybeSingle();
  if (dono?.tenant_id !== operator.tenant_id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const credential = await getCloudCredentialById(credentialId);
  if (!credential) return NextResponse.json({ error: "Credencial não encontrada" }, { status: 404 });

  const formato = TIPOS_ACEITOS[file.type];
  if (!formato) {
    return NextResponse.json(
      { error: `Tipo "${file.type}" não é aceito para cabeçalho — use JPEG/PNG, MP4/3GPP ou PDF.` },
      { status: 400 },
    );
  }
  if (file.size > TETO_BYTES[formato]) {
    return NextResponse.json(
      { error: `Arquivo passou de ${Math.round(TETO_BYTES[formato] / 1024 / 1024)}MB para ${formato.toLowerCase()}.` },
      { status: 400 },
    );
  }

  try {
    const appId = await resolveAppId(credential.access_token);
    const sessao = await createUploadSession({
      appId,
      accessToken: credential.access_token,
      fileName: file.name || "arquivo",
      fileLength: file.size,
      fileType: file.type,
    });
    const bytes = new Uint8Array(await file.arrayBuffer());
    const handle = await uploadFileBytes({ uploadSessionId: sessao, accessToken: credential.access_token, bytes });

    return NextResponse.json({ handle, formato });
  } catch (err) {
    const mensagem = err instanceof GraphApiError ? err.message : "Falha ao subir a mídia para a Meta";
    await admin.from("events_log").insert({
      tenant_id: operator.tenant_id,
      session_id: null,
      event_type: "error",
      payload: { source: "templates/upload-header-media", fileType: file.type, fileSize: file.size },
      error: mensagem,
    });
    return NextResponse.json({ error: mensagem }, { status: 502 });
  }
}
