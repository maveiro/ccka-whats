import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Formulários de cadastro. Admin-only para escrita: o formulário define o texto
// legal mostrado a terceiros e a versão que fica registrada no consentimento —
// não é conteúdo operacional como FAQ ou agenda.

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("formularios_cadastro")
    .select("id, slug, nome, artista, titulo, descricao, texto_consentimento, versao_consentimento, mensagem_sucesso, whatsapp_numero, whatsapp_mensagem, exige_nome, exige_email, dominios_permitidos, ativo, created_at")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: operator } = await supabase
    .from("operators").select("role, tenant_id").eq("id", user.id)
    .single<{ role: string; tenant_id: string }>();
  if (operator?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json() as Record<string, unknown>;
  const nome = typeof body.nome === "string" ? body.nome.trim() : "";
  const slug = typeof body.slug === "string" ? body.slug.trim().toLowerCase() : "";
  const textoConsentimento = typeof body.textoConsentimento === "string" ? body.textoConsentimento.trim() : "";

  if (!nome || !slug) return NextResponse.json({ error: "Nome e endereço são obrigatórios" }, { status: 400 });
  if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(slug)) {
    return NextResponse.json({ error: "O endereço aceita letras minúsculas, números e hífen" }, { status: 400 });
  }
  if (!textoConsentimento) {
    return NextResponse.json({ error: "O texto de consentimento é obrigatório" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("formularios_cadastro")
    .insert({
      tenant_id: operator.tenant_id,
      slug,
      nome,
      artista: typeof body.artista === "string" && body.artista.trim() ? body.artista.trim() : null,
      titulo: typeof body.titulo === "string" && body.titulo.trim() ? body.titulo.trim() : "Cadastre-se",
      descricao: typeof body.descricao === "string" && body.descricao.trim() ? body.descricao.trim() : null,
      texto_consentimento: textoConsentimento,
      // A versão nasce da data e muda quando o texto muda (ver PATCH): é o que
      // liga o consentimento registrado ao texto que a pessoa realmente leu.
      versao_consentimento: typeof body.versaoConsentimento === "string" && body.versaoConsentimento.trim()
        ? body.versaoConsentimento.trim()
        : `${slug}-v1-${new Date().toISOString().slice(0, 7)}`,
      dominios_permitidos: Array.isArray(body.dominiosPermitidos)
        ? (body.dominiosPermitidos as unknown[]).filter((d): d is string => typeof d === "string" && d.trim() !== "")
        : [],
      ativo: true,
    })
    .select("id, slug, nome, artista, titulo, descricao, texto_consentimento, versao_consentimento, mensagem_sucesso, whatsapp_numero, whatsapp_mensagem, exige_nome, exige_email, dominios_permitidos, ativo, created_at")
    .single();

  if (error) {
    const duplicado = error.code === "23505";
    return NextResponse.json(
      { error: duplicado ? "Já existe um formulário com esse endereço" : error.message },
      { status: duplicado ? 409 : 500 },
    );
  }

  return NextResponse.json(data, { status: 201 });
}
