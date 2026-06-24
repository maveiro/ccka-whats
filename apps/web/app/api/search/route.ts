import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";

async function generateQueryEmbedding(query: string): Promise<number[]> {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "text-embedding-3-small",
      input: query,
      dimensions: 1536,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI embeddings API error ${response.status}: ${err}`);
  }

  const json = await response.json() as { data: Array<{ embedding: number[] }> };
  return json.data[0].embedding;
}

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim();
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "30"), 100);
  const mode = searchParams.get("mode"); // "semantic" | null (default: FTS)

  if (!q || q.length < 2) {
    return NextResponse.json({ results: [] });
  }

  // Busca por chats pelo nome (ilike — sem generated column em chats)
  // Executada em paralelo com a busca de mensagens
  const chatsPromise = supabase
    .from("chats")
    .select("id, name, jid, last_message_at, unread_count")
    .ilike("name", `%${q}%`)
    .limit(10);

  if (mode === "semantic") {
    // ── Busca semântica via embedding ──────────────────────────────────────────
    let embedding: number[];
    try {
      embedding = await generateQueryEmbedding(q);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: `Embedding generation failed: ${errMsg}` }, { status: 500 });
    }

    // Chamar a função RPC de busca semântica
    const { data: semanticMessages, error: semanticError } = await supabase
      .rpc("search_messages_semantic", {
        query_embedding: JSON.stringify(embedding),
        match_threshold: 0.5,
        match_count: limit,
      });

    if (semanticError) {
      return NextResponse.json({ error: semanticError.message }, { status: 500 });
    }

    // Para cada mensagem semântica, enriquecer com dados do chat
    const messageIds = (semanticMessages ?? []).map(
      (m: { id: string }) => m.id
    );

    let enrichedMessages: Array<{
      id: string;
      body: string | null;
      caption: string | null;
      chat_id: string;
      from_me: boolean;
      timestamp: string;
      similarity: number;
      chats: { id: string; name: string | null; jid: string } | null;
      contacts: { push_name: string | null; name: string | null } | null;
    }> = [];

    if (messageIds.length > 0) {
      const { data: messagesWithContext } = await supabase
        .from("messages")
        .select(`
          id, type, body, caption, from_me, timestamp, chat_id,
          chats ( id, name, jid ),
          contacts ( push_name, name )
        `)
        .in("id", messageIds);

      // Merge similarity scores back in, preserving RPC order
      const similarityMap = new Map(
        (semanticMessages as Array<{ id: string; similarity: number }>).map(
          (m) => [m.id, m.similarity]
        )
      );

      enrichedMessages = (messagesWithContext ?? [])
        .map((m) => ({
          ...m,
          chats: Array.isArray(m.chats) ? (m.chats[0] ?? null) : m.chats,
          contacts: Array.isArray(m.contacts) ? (m.contacts[0] ?? null) : m.contacts,
          similarity: similarityMap.get(m.id) ?? 0,
        }))
        .sort((a, b) => b.similarity - a.similarity);
    }

    const { data: chats } = await chatsPromise;

    return NextResponse.json({
      messages: enrichedMessages,
      chats: chats ?? [],
      mode: "semantic",
    });
  }

  // ── Busca FTS (padrão) ──────────────────────────────────────────────────────
  const [{ data: messages, error }, { data: chats }] = await Promise.all([
    supabase
      .from("messages")
      .select(`
        id, type, body, caption, from_me, timestamp, chat_id,
        chats ( id, name, jid ),
        contacts ( push_name, name )
      `)
      .textSearch("search_vector", q, { type: "websearch", config: "portuguese" })
      .order("timestamp", { ascending: false })
      .limit(limit),
    chatsPromise,
  ]);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    messages: (messages ?? []).map((m) => ({
      ...m,
      chats: Array.isArray(m.chats) ? m.chats[0] ?? null : m.chats,
      contacts: Array.isArray(m.contacts) ? m.contacts[0] ?? null : m.contacts,
    })),
    chats: chats ?? [],
    mode: "fts",
  });
}
