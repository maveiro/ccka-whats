import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [2000, 5000, 10000];

const EVOLUTION_API_URL = Deno.env.get("EVOLUTION_API_URL")!;
const EVOLUTION_API_KEY = Deno.env.get("EVOLUTION_API_KEY")!;

interface DownloadPayload {
  messageId: string;       // UUID interno do banco
  tenantId: string;
  sessionId: string;
  downloadUrl: string;
  mimeType: string;
  evolutionMessageId: string;   // ID original do WhatsApp (key.id)
  instanceName: string;         // nome da instância no Evolution
  evolutionKey?: Record<string, unknown>;    // key completo {remoteJid, fromMe, id, participant?}
  evolutionMessage?: Record<string, unknown>; // message completo com mediaKey, directPath etc.
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let payload: DownloadPayload;
  try {
    payload = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const { messageId, tenantId, sessionId, downloadUrl, mimeType, evolutionMessageId, instanceName, evolutionKey, evolutionMessage } = payload;

  if (!messageId || !tenantId) {
    return new Response("Missing required fields", { status: 400 });
  }

  // Buscar registro de media_file existente
  const { data: mediaFile, error: selectError } = await supabase
    .from("media_files")
    .select("id, download_attempts")
    .eq("message_id", messageId)
    .single();

  if (selectError || !mediaFile) {
    return new Response("Media file record not found", { status: 404 });
  }

  const attempts = mediaFile.download_attempts ?? 0;

  if (attempts >= MAX_ATTEMPTS) {
    await logEvent(tenantId, sessionId, "error", { messageId }, "Max download attempts reached");
    return new Response("Max attempts reached", { status: 200 });
  }

  // Backoff se for retry
  if (attempts > 0) {
    await sleep(BACKOFF_MS[attempts - 1] ?? 10000);
  }

  // Incrementar contador de tentativas imediatamente
  await supabase
    .from("media_files")
    .update({ download_attempts: attempts + 1 })
    .eq("id", mediaFile.id);

  try {
    let fileBuffer: ArrayBuffer;

    if (evolutionMessageId && instanceName) {
      // Evolution requer o objeto message COMPLETO (com mediaKey, directPath etc.)
      // iOS PTT pode ter a mídia dentro de ephemeralMessage — tentar desempacotar.
      let unwrappedMessage = evolutionMessage;
      if (evolutionMessage?.ephemeralMessage) {
        const ephemeral = evolutionMessage.ephemeralMessage as Record<string, unknown>;
        unwrappedMessage = (ephemeral.message as Record<string, unknown>) ?? evolutionMessage;
      }

      const messagePayload = evolutionKey && unwrappedMessage
        ? { key: evolutionKey, message: unwrappedMessage }
        : { key: { id: evolutionMessageId } }; // fallback legado

      const evoRes = await fetch(
        `${EVOLUTION_API_URL}/chat/getBase64FromMediaMessage/${instanceName}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "apikey": EVOLUTION_API_KEY,
          },
          body: JSON.stringify({ message: messagePayload, convertToMp4: false }),
        },
      );

      if (!evoRes.ok) {
        // Se Evolution retornar 400, tentar fallback de download direto via URL
        if (evoRes.status === 400 && downloadUrl) {
          await logEvent(tenantId, sessionId, "media_downloaded", { messageId, note: "Evolution 400 — fallback URL download" });
          const fallbackRes = await fetch(downloadUrl);
          if (!fallbackRes.ok) {
            throw new Error(`Evolution 400 + fallback download failed: ${fallbackRes.status}`);
          }
          fileBuffer = await fallbackRes.arrayBuffer();
        } else {
          throw new Error(`Evolution getBase64 failed: ${evoRes.status} ${evoRes.statusText}`);
        }
      } else {
        const evoJson = await evoRes.json() as { base64?: string };
        if (!evoJson.base64) {
          throw new Error("Evolution returned no base64 data");
        }

        // Converter base64 para ArrayBuffer
        const binaryStr = atob(evoJson.base64.replace(/^data:[^;]+;base64,/, ""));
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
        fileBuffer = bytes.buffer;
      }
    } else {
      // Fallback: baixar direto pela URL
      if (!downloadUrl) throw new Error("No download URL or Evolution credentials provided");
      const fileResponse = await fetch(downloadUrl);
      if (!fileResponse.ok) {
        throw new Error(`Download failed: ${fileResponse.status} ${fileResponse.statusText}`);
      }
      fileBuffer = await fileResponse.arrayBuffer();
    }
    const ext = mimeTypeToExt(mimeType);
    const storagePath = `${tenantId}/${sessionId}/${messageId}.${ext}`;

    // Upload para Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from("media")
      .upload(storagePath, fileBuffer, {
        contentType: mimeType,
        upsert: true,
      });

    if (uploadError) {
      throw new Error(`Storage upload failed: ${uploadError.message}`);
    }

    // Atualizar registro com sucesso
    await supabase
      .from("media_files")
      .update({
        storage_path: storagePath,
        mime_type: mimeType,
        file_size: fileBuffer.byteLength,
        download_status: "done",
      })
      .eq("id", mediaFile.id);

    await logEvent(tenantId, sessionId, "media_downloaded", { messageId, storagePath });

    return new Response("ok", { status: 200 });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);

    await supabase
      .from("media_files")
      .update({ download_status: attempts + 1 >= MAX_ATTEMPTS ? "failed" : "pending" })
      .eq("id", mediaFile.id);

    await logEvent(tenantId, sessionId, "error", { messageId, attempt: attempts + 1 }, errorMsg);

    // Se ainda tem tentativas restantes, re-agendar
    if (attempts + 1 < MAX_ATTEMPTS) {
      triggerRetry(payload, attempts + 1);
    }

    return new Response("ok", { status: 200 });
  }
});

function triggerRetry(payload: DownloadPayload, attempt: number): void {
  const delay = BACKOFF_MS[attempt] ?? 10000;
  setTimeout(() => {
    fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/media-downloader`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify(payload),
    }).catch((err) => console.error("Retry trigger failed:", err));
  }, delay);
}

function mimeTypeToExt(mimeType: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "audio/ogg": "ogg",
    "audio/mp4": "m4a",
    "video/mp4": "mp4",
    "application/pdf": "pdf",
  };
  return map[mimeType] ?? "bin";
}

async function logEvent(
  tenantId: string,
  sessionId: string | null,
  eventType: string,
  payload: unknown,
  error?: string,
): Promise<void> {
  await supabase.from("events_log").insert({
    tenant_id: tenantId,
    session_id: sessionId,
    event_type: eventType,
    payload,
    error: error ?? null,
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
