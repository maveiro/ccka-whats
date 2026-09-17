import { redirect } from "next/navigation";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import PaginasManager from "./paginas-manager";

// Páginas públicas do artista — a que substitui o Linktree.
//
// O que é editorial (ordem dos blocos, texto, tema) vive aqui; os botões de
// show são GERADOS da agenda que vem do board do Monday. É a diferença em
// relação ao Linktree, onde as ~25 datas eram mantidas à mão.

export default async function PaginasPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: operator } = await supabase
    .from("operators")
    .select("role, tenant_id")
    .eq("id", user!.id)
    .single();

  if (!operator || !["admin", "operator"].includes(operator.role)) redirect("/dashboard");

  const { data: paginas } = await supabase
    .from("paginas_publicas")
    .select("id, slug, artista, titulo, bio, avatar_path, tema, ativo")
    .order("created_at", { ascending: true });

  const { data: blocos } = await supabase
    .from("pagina_blocos")
    .select("id, pagina_id, tipo, ordem, conteudo, ativo, cliques")
    .order("ordem", { ascending: true });

  // Artistas e espetáculos conhecidos: o bloco de agenda filtra por
  // espetáculo, e digitar o nome à mão é o jeito mais fácil de criar um bloco
  // que não mostra nada (mesma lição do casamento por nome na central).
  const admin = createAdminClient();
  const { data: credenciais } = await admin
    .from("whatsapp_cloud_credentials")
    .select("artista")
    .eq("tenant_id", operator.tenant_id)
    .not("artista", "is", null);

  const { data: temas } = await supabase
    .from("agenda_temas")
    .select("nome, artista_nome")
    .order("nome");

  const { data: shows } = await supabase
    .from("agenda_shows_sync")
    .select("artista, espetaculo, publicado")
    .eq("publicado", true);

  const artistas = Array.from(new Set((credenciais ?? []).map((c) => c.artista as string))).sort();

  // Quantos shows cada (artista, espetáculo) tem no ar — é o que diz se um
  // bloco de agenda vai aparecer ou ficar vazio.
  const contagem: Record<string, number> = {};
  for (const s of shows ?? []) {
    const k = `${s.artista}||${s.espetaculo ?? ""}`;
    contagem[k] = (contagem[k] ?? 0) + 1;
  }

  return (
    <div className="p-6 max-w-4xl space-y-8">
      <div>
        <h1 className="text-lg font-semibold text-white">Páginas públicas</h1>
        <p className="text-sm text-gray-400 mt-1">
          A página do artista, para pôr na bio. Os botões de show saem da agenda
          sincronizada do Monday — inclusive o &quot;esgotado&quot; — então data nova entra e data
          que passou sai sem ninguém editar.
        </p>
      </div>

      <PaginasManager
        paginasIniciais={paginas ?? []}
        blocosIniciais={blocos ?? []}
        artistas={artistas}
        espetaculos={(temas ?? []).map((t) => ({ nome: t.nome as string, artista: (t.artista_nome ?? null) as string | null }))}
        contagemShows={contagem}
        isAdmin={operator.role === "admin"}
        urlBase={process.env.NEXT_PUBLIC_SUPABASE_URL!.replace(/\/+$/, "")}
      />
    </div>
  );
}
