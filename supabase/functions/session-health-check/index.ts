import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const EVOLUTION_API_URL = Deno.env.get("EVOLUTION_API_URL")!;
const EVOLUTION_API_KEY = Deno.env.get("EVOLUTION_API_KEY")!;

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // Buscar todas as sessões que não estão banidas
  const { data: sessions, error } = await supabase
    .from("wa_sessions")
    .select("id, tenant_id, evolution_instance_name, status")
    .neq("status", "banned")
    .not("evolution_instance_name", "is", null);

  if (error) {
    console.error("Failed to fetch sessions:", error);
    return new Response("Database error", { status: 500 });
  }

  if (!sessions || sessions.length === 0) {
    return new Response("No active sessions", { status: 200 });
  }

  // Verificar status + sync nomes de grupos e contatos para sessões conectadas
  await Promise.allSettled([
    ...sessions.map(checkSession),
    ...sessions.filter((s) => s.status === "connected").map(syncGroupNames),
    ...sessions.filter((s) => s.status === "connected").map(syncContactNames),
  ]);

  return new Response("ok", { status: 200 });
});

async function checkSession(session: {
  id: string;
  tenant_id: string;
  evolution_instance_name: string;
  status: string;
}): Promise<void> {
  const { id: sessionId, tenant_id: tenantId, evolution_instance_name: instanceName, status: currentStatus } = session;

  let newStatus: string;

  try {
    const res = await fetch(
      `${EVOLUTION_API_URL}/instance/connectionState/${instanceName}`,
      {
        headers: { "apikey": EVOLUTION_API_KEY },
      },
    );

    if (res.status === 404) {
      // Instância não existe mais no Evolution
      newStatus = "disconnected";
    } else if (!res.ok) {
      console.error(`Evolution API error for ${instanceName}: ${res.status}`);
      return;
    } else {
      const body = await res.json() as Record<string, unknown>;
      const state = (body.instance as Record<string, unknown>)?.state as string ?? "close";

      const stateMap: Record<string, string> = {
        open: "connected",
        close: "disconnected",
        connecting: "connecting",
      };

      newStatus = stateMap[state] ?? "disconnected";
    }
  } catch (err) {
    console.error(`Failed to reach Evolution for ${instanceName}:`, err);
    return;
  }

  // Só atualizar se o status mudou
  if (newStatus === currentStatus) {
    // Apenas atualizar last_seen_at se conectado
    if (newStatus === "connected") {
      await supabase
        .from("wa_sessions")
        .update({ last_seen_at: new Date().toISOString() })
        .eq("id", sessionId);
    }
    return;
  }

  await supabase
    .from("wa_sessions")
    .update({ status: newStatus, last_seen_at: new Date().toISOString() })
    .eq("id", sessionId);

  await supabase.from("events_log").insert({
    tenant_id: tenantId,
    session_id: sessionId,
    event_type: "session_status_changed",
    payload: { from: currentStatus, to: newStatus, instance: instanceName },
  });
}

// Busca grupos cujo nome ainda é o JID (não resolvido) e atualiza via Evolution API.
async function syncGroupNames(session: {
  id: string;
  evolution_instance_name: string;
}): Promise<void> {
  const { id: sessionId, evolution_instance_name: instanceName } = session;

  // Pegar grupos com nome igual ao JID (não resolvido)
  const { data: groups } = await supabase
    .from("chats")
    .select("id, jid, name")
    .eq("session_id", sessionId)
    .like("jid", "%@g.us")
    .limit(50);

  if (!groups || groups.length === 0) return;

  // Filtrar só os que o nome parece ser o JID (não resolvido)
  const unresolved = groups.filter((g) => !g.name || g.name === g.jid || g.name.endsWith("@g.us"));
  if (unresolved.length === 0) return;

  // Buscar todos os grupos do Evolution de uma só vez
  try {
    const res = await fetch(
      `${EVOLUTION_API_URL}/group/fetchAllGroups/${instanceName}?getParticipants=false`,
      { headers: { "apikey": EVOLUTION_API_KEY } },
    );
    if (!res.ok) return;

    const data = await res.json() as Array<Record<string, unknown>>;
    if (!Array.isArray(data)) return;

    // Montar mapa JID → subject
    const subjectMap = new Map<string, string>();
    for (const g of data) {
      const jid = g.id as string | undefined;
      const subject = (g.subject ?? g.name) as string | undefined;
      if (jid && subject && subject.trim()) {
        subjectMap.set(jid, subject.trim());
      }
    }

    // Atualizar chats não resolvidos
    await Promise.allSettled(
      unresolved.map(async (chat) => {
        const subject = subjectMap.get(chat.jid);
        if (subject) {
          await supabase.from("chats").update({ name: subject }).eq("id", chat.id);
        }
      }),
    );
  } catch (err) {
    console.error(`Failed to sync group names for ${instanceName}:`, err);
  }
}

// Busca contatos (@s.whatsapp.net e @lid) cujo nome ainda é o JID bruto e resolve via Evolution API.
async function syncContactNames(session: {
  id: string;
  evolution_instance_name: string;
}): Promise<void> {
  const { id: sessionId, evolution_instance_name: instanceName } = session;

  // Chats de DM com nome que parece ser JID (contém @ — não foi resolvido ainda)
  const { data: chats } = await supabase
    .from("chats")
    .select("id, jid, name")
    .eq("session_id", sessionId)
    .or("jid.like.%@s.whatsapp.net,jid.like.%@lid")
    .limit(100);

  if (!chats || chats.length === 0) return;

  const unresolved = chats.filter(
    (c) => !c.name || c.name === c.jid || c.name.includes("@"),
  );
  if (unresolved.length === 0) return;

  try {
    const res = await fetch(
      `${EVOLUTION_API_URL}/contact/fetchContacts/${instanceName}`,
      {
        method: "GET",
        headers: { "apikey": EVOLUTION_API_KEY },
      },
    );
    if (!res.ok) return;

    const data = await res.json() as Array<Record<string, unknown>>;
    if (!Array.isArray(data)) return;

    const contactMap = new Map<string, string>();
    for (const c of data) {
      const jid = (c.id ?? c.remoteJid) as string | undefined;
      const name = (c.pushName ?? c.name ?? c.notify) as string | undefined;
      if (jid && name && name.trim()) contactMap.set(jid, name.trim());
    }

    await Promise.allSettled(
      unresolved.map(async (chat) => {
        const name = contactMap.get(chat.jid);
        if (name) {
          await supabase.from("chats").update({ name }).eq("id", chat.id);
        }
      }),
    );
  } catch (err) {
    console.error(`Failed to sync contact names for ${instanceName}:`, err);
  }
}
