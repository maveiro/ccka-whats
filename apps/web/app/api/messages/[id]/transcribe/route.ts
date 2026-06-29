import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantOpenAIKey } from "@/lib/ai";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { key: apiKey } = await getTenantOpenAIKey(supabase);
  if (!apiKey) {
    return NextResponse.json({ error: "IA não configurada" }, { status: 503 });
  }

  // Buscar mensagem e mídia
  const { data: msg } = await supabase
    .from("messages")
    .select("id, type, media_files ( storage_path, mime_type, download_status )")
    .eq("id", id)
    .single();

  if (!msg) return NextResponse.json({ error: "Mensagem não encontrada" }, { status: 404 });
  if (!["audio", "ptt"].includes(msg.type)) {
    return NextResponse.json({ error: "Mensagem não é áudio" }, { status: 400 });
  }

  const media = Array.isArray(msg.media_files) ? msg.media_files[0] : msg.media_files;
  if (!media?.storage_path || media.download_status !== "done") {
    return NextResponse.json({ error: "Áudio ainda não baixado" }, { status: 400 });
  }

  // Baixar áudio do Storage
  const { data: fileData, error: downloadErr } = await supabase.storage
    .from("media")
    .download(media.storage_path);

  if (downloadErr || !fileData) {
    return NextResponse.json({ error: "Falha ao baixar áudio do storage" }, { status: 500 });
  }

  // Enviar para Whisper API
  const formData = new FormData();
  const ext = media.mime_type === "audio/ogg" ? "ogg"
    : media.mime_type === "audio/mp4" ? "m4a"
    : "ogg";
  formData.append("file", new File([fileData], `audio.${ext}`, { type: media.mime_type ?? "audio/ogg" }));
  formData.append("model", "whisper-1");
  formData.append("language", "pt");

  const whisperRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });

  if (!whisperRes.ok) {
    const errText = await whisperRes.text();
    return NextResponse.json({ error: `Whisper error: ${errText}` }, { status: 502 });
  }

  const { text: transcript } = await whisperRes.json() as { text: string };

  // Salvar transcrição no body da mensagem (se estiver vazio)
  await supabase
    .from("messages")
    .update({ body: transcript })
    .eq("id", id)
    .is("body", null);

  return NextResponse.json({ transcript });
}
