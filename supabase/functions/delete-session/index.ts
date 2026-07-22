import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const EVOLUTION_API_URL = Deno.env.get("EVOLUTION_API_URL")!;
const EVOLUTION_API_KEY = Deno.env.get("EVOLUTION_API_KEY")!;
const BATCH_SIZE = 500;

interface DeleteRequest {
  sessionId: string;
}

// Sessões com muito histórico (dezenas de milhares de mensagens) estouram o
// timeout da API do Supabase se apagadas com um único DELETE cascata via
// PostgREST/RPC (~9s, imposto na borda — não é statement_timeout do Postgres,
// que pode ser sobrescrito com SET LOCAL sem efeito nenhum). Solução: apagar
// em lotes, cada um um request HTTP curto e independente, dentro do
// orçamento bem maior de uma Edge Function.
Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let body: DeleteRequest;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const { sessionId } = body;
  if (!sessionId) {
    return new Response("sessionId is required", { status: 400 });
  }

  const { data: session, error: sessionError } = await supabase
    .from("wa_sessions")
    .select("tenant_id, label, evolution_instance_name")
    .eq("id", sessionId)
    .single();

  if (sessionError || !session) {
    return new Response("Session not found", { status: 404 });
  }

  const { tenant_id: tenantId, label, evolution_instance_name: instanceName } = session;

  try {
    if (instanceName) {
      await fetch(`${EVOLUTION_API_URL}/instance/delete/${instanceName}`, {
        method: "DELETE",
        headers: { "apikey": EVOLUTION_API_KEY },
      }).catch(() => {});
    }

    // Mensagens em lotes (cascade remove media_files via FK).
    // .order()+.limit() no delete evita URLs enormes de um .in() com milhares de ids.
    let totalDeleted = 0;
    while (true) {
      const { data: batch, error: deleteErr } = await supabase
        .from("messages")
        .delete()
        .eq("session_id", sessionId)
        .limit(BATCH_SIZE)
        .select("id");

      if (deleteErr) throw new Error(`delete messages batch: ${deleteErr.message}`);
      if (!batch || batch.length === 0) break;
      totalDeleted += batch.length;
      if (batch.length < BATCH_SIZE) break;
    }

    const { error: chatsErr } = await supabase.from("chats").delete().eq("session_id", sessionId);
    if (chatsErr) throw new Error(`delete chats: ${chatsErr.message}`);

    const { error: sessionDeleteErr } = await supabase.from("wa_sessions").delete().eq("id", sessionId);
    if (sessionDeleteErr) throw new Error(`delete wa_sessions: ${sessionDeleteErr.message}`);

    // media_files (e os arquivos que apontavam) já foram cascade-deletados junto com as
    // mensagens, mas os objetos no Storage não são removidos por cascade de FK — o
    // storage_path só existia na linha já apagada. Sem isso, os arquivos ficam órfãos
    // no bucket para sempre (achado em produção em 22/07/2026: ~960MB órfãos numa única sessão).
    let mediaDeleted = 0;
    const mediaPrefix = `${tenantId}/${sessionId}`;
    while (true) {
      const { data: objects, error: listErr } = await supabase.storage
        .from("media")
        .list(mediaPrefix, { limit: BATCH_SIZE });

      if (listErr) throw new Error(`list media: ${listErr.message}`);
      if (!objects || objects.length === 0) break;

      const paths = objects.map((obj) => `${mediaPrefix}/${obj.name}`);
      const { error: removeErr } = await supabase.storage.from("media").remove(paths);
      if (removeErr) throw new Error(`remove media: ${removeErr.message}`);

      mediaDeleted += paths.length;
      if (objects.length < BATCH_SIZE) break;
    }

    await supabase.from("events_log").insert({
      tenant_id: tenantId,
      session_id: null,
      event_type: "session_deleted",
      payload: { label, evolution_instance_name: instanceName, messagesDeleted: totalDeleted, mediaFilesDeleted: mediaDeleted },
      error: null,
    });

    return new Response(JSON.stringify({ ok: true, messagesDeleted: totalDeleted }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabase.from("events_log").insert({
      tenant_id: tenantId,
      session_id: sessionId,
      event_type: "session_delete_failed",
      payload: { label },
      error: message,
    });
    return new Response(JSON.stringify({ error: message }), {
      headers: { "Content-Type": "application/json" },
      status: 500,
    });
  }
});
