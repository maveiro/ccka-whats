import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

// Login via Google fica restrito a operadores já convidados (nunca autocadastra) e,
// hoje, ao domínio @plauz.com.br — ver regra correspondente no CLAUDE.md.
const ALLOWED_GOOGLE_DOMAINS = ["plauz.com.br"];

export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url);
  const code = searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=oauth_missing_code`);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.user) {
    return NextResponse.redirect(`${origin}/login?error=oauth_exchange_failed`);
  }

  const email = data.user.email ?? "";
  const domain = email.split("@")[1]?.toLowerCase();

  if (!domain || !ALLOWED_GOOGLE_DOMAINS.includes(domain)) {
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/login?error=unauthorized_domain`);
  }

  const admin = createAdminClient();
  const { data: operatorRow } = await admin
    .from("operators")
    .select("id")
    .eq("id", data.user.id)
    .maybeSingle();

  if (!operatorRow) {
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/login?error=unauthorized_operator`);
  }

  return NextResponse.redirect(`${origin}/dashboard`);
}
