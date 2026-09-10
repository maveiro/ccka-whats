import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json() as Record<string, unknown>;
  const patch: Record<string, unknown> = {};

  for (const [api, coluna] of [
    ["titulo", "titulo"],
    ["descricao", "descricao"],
    ["mensagemSucesso", "mensagem_sucesso"],
    ["artista", "artista"],
    ["whatsappNumero", "whatsapp_numero"],
    ["whatsappMensagem", "whatsapp_mensagem"],
  ] as const) {
    if (typeof body[api] === "string") patch[coluna] = (body[api] as string).trim() || null;
  }
  if (typeof body.ativo === "boolean") patch.ativo = body.ativo;
  if (typeof body.exigeNome === "boolean") patch.exige_nome = body.exigeNome;
  if (typeof body.exigeEmail === "boolean") patch.exige_email = body.exigeEmail;
  if (Array.isArray(body.dominiosPermitidos)) {
    patch.dominios_permitidos = (body.dominiosPermitidos as unknown[])
      .filter((d): d is string => typeof d === "string" && d.trim() !== "")
      .map((d) => d.trim());
  }

  // Mudar o texto de consentimento SEM mudar a versão tornaria falso todo
  // consentimento já registrado — quem aceitou o texto antigo apareceria como
  // tendo aceitado o novo. Por isso a versão é obrigatória junto.
  if (typeof body.textoConsentimento === "string" && body.textoConsentimento.trim()) {
    const versao = typeof body.versaoConsentimento === "string" ? body.versaoConsentimento.trim() : "";
    if (!versao) {
      return NextResponse.json(
        { error: "Ao mudar o texto de consentimento, informe também uma nova versão — sem isso, quem aceitou o texto anterior apareceria como tendo aceitado este." },
        { status: 400 },
      );
    }
    patch.texto_consentimento = body.textoConsentimento.trim();
    patch.versao_consentimento = versao;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nada para atualizar" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("formularios_cadastro")
    .update(patch).eq("id", id).is("deleted_at", null)
    .select("id, slug, nome, artista, titulo, descricao, texto_consentimento, versao_consentimento, mensagem_sucesso, whatsapp_numero, whatsapp_mensagem, exige_nome, exige_email, dominios_permitidos, ativo, created_at")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Formulário não encontrado" }, { status: 404 });
  return NextResponse.json(data);
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Soft-delete: o slug pode estar embutido num site que não controlamos, e o
  // histórico de qual texto de consentimento estava no ar precisa sobreviver.
  const { data, error } = await supabase
    .from("formularios_cadastro")
    .update({ deleted_at: new Date().toISOString(), ativo: false })
    .eq("id", id).is("deleted_at", null)
    .select("id").maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Formulário não encontrado" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
