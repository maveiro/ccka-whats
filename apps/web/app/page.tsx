import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// A raiz de link.plauz.com.br não é página nossa: é o endereço que sobra
// quando alguém encurta o link recebido.
//
// Até 21/09/2026 ela era a tela padrão do create-next-app ("To get started,
// edit the page.tsx file"), o que não incomodava ninguém enquanto o domínio
// era uma URL interna da Vercel. Passa a incomodar agora: este domínio vai no
// botão de um template de marketing, e é para cá que `/c/` e `/l/` mandam o
// clique que não resolveu (regra 34) — quem trimar a URL, ou perder o token,
// merece achar a Plauz, não um projeto em branco. A revisão da Meta também
// abre a raiz do domínio que aparece no botão.
//
// Quem tem sessão vai para o painel: o dashboard é servido por este mesmo
// host, e mandar um operador com bookmark na raiz para o site institucional
// seria trocar um incômodo por outro.
export default async function Raiz() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (user) redirect("/dashboard");
  redirect("https://plauz.com.br");
}
