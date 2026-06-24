import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const PAGE_SIZE = 50;

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const chatId = searchParams.get("chatId");
  const before = searchParams.get("before");   // ISO timestamp — carregar mensagens antes desta
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50"), 100);

  if (!chatId) return NextResponse.json({ error: "chatId required" }, { status: 400 });

  let query = supabase
    .from("messages")
    .select(`
      id, type, body, caption, from_me, timestamp,
      deleted_at, edited_at, delivery_status,
      media_files ( storage_path, mime_type, download_status ),
      contacts ( push_name, name )
    `)
    .eq("chat_id", chatId)
    .order("timestamp", { ascending: false })
    .limit(limit);

  if (before) {
    query = query.lt("timestamp", before);
  }

  const { data: rawMessages, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Inverter para ordem cronológica
  const sorted = (rawMessages ?? []).reverse();

  // Gerar signed URLs para mídias
  const messages = await Promise.all(
    sorted.map(async (msg) => {
      const media = Array.isArray(msg.media_files) ? msg.media_files[0] ?? null : msg.media_files;
      const contacts = Array.isArray(msg.contacts) ? msg.contacts[0] ?? null : msg.contacts;
      if (media?.storage_path && media.download_status === "done") {
        const { data: signed } = await supabase.storage
          .from("media")
          .createSignedUrl(media.storage_path, 3600);
        return { ...msg, media_files: media ? [media] : null, contacts, signedUrl: signed?.signedUrl ?? null };
      }
      return { ...msg, media_files: media ? [media] : null, contacts, signedUrl: null };
    })
  );

  return NextResponse.json({ messages });
}
