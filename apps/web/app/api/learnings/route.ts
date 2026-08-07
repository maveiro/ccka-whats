import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: operator } = await supabase.from("operators").select("role, tenant_id").eq("id", user.id).single();
  if (!operator) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json() as { title?: unknown; description?: unknown; category?: unknown };
  const { title, description, category } = body;

  if (typeof title !== "string" || !title.trim() || typeof description !== "string" || !description.trim()) {
    return NextResponse.json({ error: "title e description são obrigatórios" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("learnings")
    .insert({
      tenant_id: operator.tenant_id,
      created_by: user.id,
      title: title.trim(),
      description: description.trim(),
      category: typeof category === "string" && category.trim() ? category.trim() : "geral",
    })
    .select("id, title, description, category, created_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
