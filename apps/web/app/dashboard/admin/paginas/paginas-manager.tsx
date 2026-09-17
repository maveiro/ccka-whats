"use client";

import { useState } from "react";
import { toast } from "sonner";
import { contraste, lerTema, type Tema } from "@/lib/pagina-tema";

// Editor das páginas públicas. Cada página tem tema próprio (pedido do
// fundador: personalização "por linktree"), e por isso a tela avisa quando a
// combinação de cores fica ilegível — avisar é melhor que proibir, é a página
// do artista, não a nossa.

interface Pagina {
  id: string;
  slug: string;
  artista: string | null;
  titulo: string;
  bio: string | null;
  avatar_path: string | null;
  tema: unknown;
  ativo: boolean;
}

interface Bloco {
  id: string;
  pagina_id: string;
  tipo: "texto" | "link" | "imagem" | "agenda";
  ordem: number;
  conteudo: Record<string, unknown>;
  ativo: boolean;
  cliques: number;
}

const ROTULO_TIPO: Record<Bloco["tipo"], string> = {
  texto: "Texto",
  link: "Botão de link",
  imagem: "Imagem",
  agenda: "Agenda de shows",
};

export default function PaginasManager({
  paginasIniciais, blocosIniciais, artistas, espetaculos, contagemShows, isAdmin, urlBase,
}: {
  paginasIniciais: Pagina[];
  blocosIniciais: Bloco[];
  artistas: string[];
  espetaculos: { nome: string; artista: string | null }[];
  contagemShows: Record<string, number>;
  isAdmin: boolean;
  urlBase: string;
}) {
  const [paginas, setPaginas] = useState(paginasIniciais);
  const [blocos, setBlocos] = useState(blocosIniciais);
  const [aberta, setAberta] = useState<string | null>(paginasIniciais[0]?.id ?? null);
  const [criando, setCriando] = useState(false);
  const [slug, setSlug] = useState("");
  const [titulo, setTitulo] = useState("");

  const bucket = `${urlBase}/storage/v1/object/public/paginas`;
  const pagina = paginas.find((p) => p.id === aberta) ?? null;
  const daPagina = blocos.filter((b) => b.pagina_id === aberta).sort((a, b) => a.ordem - b.ordem);

  async function chamar(url: string, metodo: string, corpo?: unknown) {
    const res = await fetch(url, {
      method: metodo,
      headers: corpo ? { "Content-Type": "application/json" } : undefined,
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((json as { error?: string }).error ?? `Erro ${res.status}`);
    return json;
  }

  async function criarPagina() {
    setCriando(true);
    try {
      const nova = await chamar("/api/paginas", "POST", { slug, titulo }) as { id: string; slug: string };
      setPaginas((p) => [...p, {
        id: nova.id, slug: nova.slug, titulo, artista: null, bio: null,
        avatar_path: null, tema: {}, ativo: true,
      }]);
      setAberta(nova.id);
      setSlug(""); setTitulo("");
      toast.success("Página criada");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setCriando(false);
    }
  }

  async function salvarPagina(patch: Partial<Record<string, unknown>>) {
    if (!pagina) return;
    try {
      await chamar(`/api/paginas/${pagina.id}`, "PATCH", patch);
      setPaginas((ps) => ps.map((p) => p.id === pagina.id ? { ...p, ...traduzir(patch) } : p));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  function traduzir(patch: Record<string, unknown>): Partial<Pagina> {
    const out: Partial<Pagina> = {};
    if ("titulo" in patch) out.titulo = patch.titulo as string;
    if ("bio" in patch) out.bio = patch.bio as string;
    if ("artista" in patch) out.artista = patch.artista as string;
    if ("avatarPath" in patch) out.avatar_path = patch.avatarPath as string;
    if ("tema" in patch) out.tema = patch.tema;
    if ("ativo" in patch) out.ativo = patch.ativo as boolean;
    return out;
  }

  async function subirImagem(file: File): Promise<string | null> {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/paginas/upload", { method: "POST", body: form });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error((json as { error?: string }).error ?? "Falha no upload");
      return null;
    }
    return (json as { path: string }).path;
  }

  async function novoBloco(tipo: Bloco["tipo"]) {
    if (!pagina) return;
    const conteudo: Record<string, unknown> =
      tipo === "agenda" ? { titulo: "PRÓXIMOS SHOWS" }
      : tipo === "link" ? { rotulo: "Novo botão", url: "" }
      : tipo === "texto" ? { titulo: "", texto: "" }
      : {};
    try {
      const b = await chamar(`/api/paginas/${pagina.id}/blocos`, "POST", { tipo, conteudo }) as Bloco;
      setBlocos((bs) => [...bs, { ...b, pagina_id: pagina.id }]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  async function salvarBloco(id: string, patch: { conteudo?: Record<string, unknown>; ativo?: boolean }) {
    try {
      await chamar(`/api/paginas/blocos/${id}`, "PATCH", patch);
      setBlocos((bs) => bs.map((b) => b.id === id ? { ...b, ...patch } as Bloco : b));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  async function removerBloco(id: string) {
    if (!confirm("Remover este bloco da página?")) return;
    try {
      await chamar(`/api/paginas/blocos/${id}`, "DELETE");
      setBlocos((bs) => bs.filter((b) => b.id !== id));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  async function mover(id: string, direcao: -1 | 1) {
    const lista = [...daPagina];
    const i = lista.findIndex((b) => b.id === id);
    const j = i + direcao;
    if (i < 0 || j < 0 || j >= lista.length) return;
    [lista[i], lista[j]] = [lista[j], lista[i]];

    // Atualiza a tela antes da resposta: reordenar é a ação mais repetida
    // aqui, e esperar o servidor a cada clique faz a lista "pular".
    setBlocos((bs) => bs.map((b) => {
      const nova = lista.findIndex((x) => x.id === b.id);
      return nova >= 0 ? { ...b, ordem: (nova + 1) * 10 } : b;
    }));

    try {
      await chamar(`/api/paginas/${aberta}/blocos`, "PATCH", { ordem: lista.map((b) => b.id) });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  const tema: Tema = lerTema(pagina?.tema);
  const contrasteBotao = contraste(tema.cor_botao, tema.cor_texto_botao);
  const contrasteFundo = contraste(tema.cor_fundo, tema.cor_texto);

  return (
    <div className="space-y-6">
      {/* ─── Páginas ─── */}
      <div className="flex flex-wrap items-center gap-2">
        {paginas.map((p) => (
          <button
            key={p.id}
            onClick={() => setAberta(p.id)}
            className={`text-xs px-3 py-1.5 rounded-md border ${
              p.id === aberta
                ? "bg-green-900/40 border-green-700 text-green-300"
                : "bg-gray-900 border-gray-800 text-gray-400 hover:text-white"
            }`}
          >
            /{p.slug}{!p.ativo && " (fora do ar)"}
          </button>
        ))}
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-3">
        <p className="text-xs font-medium text-white">Nova página</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
            placeholder="endereço (ex: indiobehn)"
            className="px-3 py-2 rounded-md bg-gray-800 border border-gray-700 text-white text-sm"
          />
          <input
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            placeholder="Título (ex: Dra. Rosângela / Índio Behn)"
            className="px-3 py-2 rounded-md bg-gray-800 border border-gray-700 text-white text-sm"
          />
        </div>
        <button
          onClick={criarPagina}
          disabled={criando || slug.length < 3 || !titulo.trim()}
          className="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white text-sm rounded-md"
        >
          {criando ? "Criando..." : "Criar página"}
        </button>
      </div>

      {pagina && (
        <>
          {/* ─── Identidade ─── */}
          <section className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-white">Perfil</p>
              <a
                href={`/a/${pagina.slug}`}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-green-400 hover:text-green-300"
              >
                abrir /a/{pagina.slug} ↗
              </a>
            </div>

            <Campo label="Título" valor={pagina.titulo} onSalvar={(v) => salvarPagina({ titulo: v })} />
            <Campo label="Bio" valor={pagina.bio ?? ""} onSalvar={(v) => salvarPagina({ bio: v })} multilinha />

            <label className="block text-xs text-gray-400 space-y-1">
              <span>Artista (de quem a agenda vem)</span>
              <select
                value={pagina.artista ?? ""}
                onChange={(e) => salvarPagina({ artista: e.target.value })}
                className="w-full px-3 py-2 rounded-md bg-gray-800 border border-gray-700 text-white text-sm"
              >
                <option value="">Sem agenda</option>
                {artistas.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </label>

            <div className="flex items-center gap-3">
              {pagina.avatar_path && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`${bucket}/${pagina.avatar_path}`} alt="" className="h-12 w-12 rounded-full object-cover" />
              )}
              <label className="text-xs text-gray-400">
                <span className="block mb-1">Avatar</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    const path = await subirImagem(f);
                    if (path) await salvarPagina({ avatarPath: path });
                  }}
                  className="text-xs text-gray-300"
                />
              </label>
            </div>

            <label className="flex items-center gap-2 text-xs text-gray-400">
              <input
                type="checkbox"
                checked={pagina.ativo}
                onChange={(e) => salvarPagina({ ativo: e.target.checked })}
              />
              Página no ar
            </label>
          </section>

          {/* ─── Tema ─── */}
          <section className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-3">
            <p className="text-xs font-medium text-white">Aparência desta página</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Cor label="Fundo" valor={tema.cor_fundo} onSalvar={(v) => salvarPagina({ tema: { ...tema, cor_fundo: v } })} />
              <Cor label="Texto" valor={tema.cor_texto} onSalvar={(v) => salvarPagina({ tema: { ...tema, cor_texto: v } })} />
              <Cor label="Botão" valor={tema.cor_botao} onSalvar={(v) => salvarPagina({ tema: { ...tema, cor_botao: v } })} />
              <Cor label="Texto do botão" valor={tema.cor_texto_botao} onSalvar={(v) => salvarPagina({ tema: { ...tema, cor_texto_botao: v } })} />
            </div>

            <label className="block text-xs text-gray-400 space-y-1 max-w-[220px]">
              <span>Formato do botão</span>
              <select
                value={tema.estilo_botao}
                onChange={(e) => salvarPagina({ tema: { ...tema, estilo_botao: e.target.value } })}
                className="w-full px-3 py-2 rounded-md bg-gray-800 border border-gray-700 text-white text-sm"
              >
                <option value="arredondado">Arredondado</option>
                <option value="pilula">Pílula</option>
                <option value="reto">Reto</option>
              </select>
            </label>

            {/* Personalização livre tem um efeito colateral previsível: texto
                que ninguém lê. A régua é o contraste WCAG (4.5 para texto). */}
            {(contrasteBotao < 4.5 || contrasteFundo < 4.5) && (
              <p className="text-xs text-amber-400 bg-amber-900/20 border border-amber-900 rounded-md px-3 py-2">
                Contraste baixo
                {contrasteFundo < 4.5 && ` no texto sobre o fundo (${contrasteFundo.toFixed(1)}:1)`}
                {contrasteBotao < 4.5 && `${contrasteFundo < 4.5 ? " e" : ""} no texto do botão (${contrasteBotao.toFixed(1)}:1)`}
                . O recomendado é 4,5:1 — abaixo disso fica difícil de ler no celular, no sol.
              </p>
            )}

            <div className="rounded-md p-4 space-y-2" style={{ background: tema.cor_fundo, color: tema.cor_texto }}>
              <p className="text-xs opacity-80">prévia</p>
              <div
                className="px-4 py-3 text-center text-sm"
                style={{ background: tema.cor_botao, color: tema.cor_texto_botao, borderRadius: tema.estilo_botao === "pilula" ? 9999 : tema.estilo_botao === "reto" ? 0 : 12 }}
              >
                CURITIBA/PR · 20 SET
              </div>
            </div>
          </section>

          {/* ─── Blocos ─── */}
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-medium text-white">Blocos ({daPagina.length})</p>
              <div className="flex gap-2">
                {(["agenda", "link", "texto", "imagem"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => novoBloco(t)}
                    className="text-xs px-2 py-1 rounded-md bg-gray-800 border border-gray-700 text-gray-300 hover:text-white"
                  >
                    + {ROTULO_TIPO[t]}
                  </button>
                ))}
              </div>
            </div>

            {daPagina.map((bloco, i) => (
              <BlocoEditor
                key={bloco.id}
                bloco={bloco}
                primeiro={i === 0}
                ultimo={i === daPagina.length - 1}
                espetaculos={espetaculos}
                contagemShows={contagemShows}
                artistaDaPagina={pagina.artista}
                bucket={bucket}
                onSalvar={(patch) => salvarBloco(bloco.id, patch)}
                onRemover={() => removerBloco(bloco.id)}
                onMover={(d) => mover(bloco.id, d)}
                onSubirImagem={subirImagem}
              />
            ))}

            {daPagina.length === 0 && (
              <p className="text-sm text-gray-500">
                Nenhum bloco ainda. Comece por <b>Agenda de shows</b> — ele já vem preenchido
                com as datas do board.
              </p>
            )}
          </section>

          {isAdmin && (
            <button
              onClick={async () => {
                if (!confirm(`Remover a página /a/${pagina.slug}? O endereço deixa de funcionar.`)) return;
                try {
                  await chamar(`/api/paginas/${pagina.id}`, "DELETE");
                  setPaginas((ps) => ps.filter((p) => p.id !== pagina.id));
                  setAberta(null);
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : String(err));
                }
              }}
              className="text-xs text-gray-500 hover:text-red-400"
            >
              remover esta página
            </button>
          )}
        </>
      )}
    </div>
  );
}

function BlocoEditor({
  bloco, primeiro, ultimo, espetaculos, contagemShows, artistaDaPagina, bucket,
  onSalvar, onRemover, onMover, onSubirImagem,
}: {
  bloco: Bloco;
  primeiro: boolean;
  ultimo: boolean;
  espetaculos: { nome: string; artista: string | null }[];
  contagemShows: Record<string, number>;
  artistaDaPagina: string | null;
  bucket: string;
  onSalvar: (patch: { conteudo?: Record<string, unknown>; ativo?: boolean }) => void;
  onRemover: () => void;
  onMover: (d: -1 | 1) => void;
  onSubirImagem: (f: File) => Promise<string | null>;
}) {
  const c = bloco.conteudo;
  const texto = (k: string) => (typeof c[k] === "string" ? c[k] as string : "");
  const salvarCampo = (k: string, v: string) => onSalvar({ conteudo: { ...c, [k]: v } });

  const espetaculoEscolhido = texto("espetaculo");
  const quantos = artistaDaPagina
    ? contagemShows[`${artistaDaPagina}||${espetaculoEscolhido}`] ??
      (espetaculoEscolhido ? 0 : Object.entries(contagemShows)
        .filter(([k]) => k.startsWith(`${artistaDaPagina}||`))
        .reduce((s, [, v]) => s + v, 0))
    : 0;

  return (
    <div className={`bg-gray-900 border rounded-lg p-4 space-y-3 ${bloco.ativo ? "border-gray-800" : "border-gray-800/50 opacity-60"}`}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-gray-300">
          {ROTULO_TIPO[bloco.tipo]}
          {bloco.cliques > 0 && <span className="text-gray-500"> · {bloco.cliques} clique(s)</span>}
        </p>
        <div className="flex items-center gap-2 text-xs">
          <button onClick={() => onMover(-1)} disabled={primeiro} className="text-gray-400 hover:text-white disabled:opacity-30">↑</button>
          <button onClick={() => onMover(1)} disabled={ultimo} className="text-gray-400 hover:text-white disabled:opacity-30">↓</button>
          <button onClick={() => onSalvar({ ativo: !bloco.ativo })} className="text-gray-400 hover:text-white">
            {bloco.ativo ? "esconder" : "mostrar"}
          </button>
          <button onClick={onRemover} className="text-gray-500 hover:text-red-400">remover</button>
        </div>
      </div>

      {bloco.tipo === "texto" && (
        <>
          <Campo label="Título (opcional)" valor={texto("titulo")} onSalvar={(v) => salvarCampo("titulo", v)} />
          <Campo label="Texto" valor={texto("texto")} onSalvar={(v) => salvarCampo("texto", v)} multilinha />
        </>
      )}

      {bloco.tipo === "link" && (
        <>
          <Campo label="Rótulo do botão" valor={texto("rotulo")} onSalvar={(v) => salvarCampo("rotulo", v)} />
          <Campo label="Destino (URL)" valor={texto("url")} onSalvar={(v) => salvarCampo("url", v)} />
          <ImagemDoBloco bucket={bucket} path={texto("imagem_path")} onSubir={onSubirImagem} onSalvar={(p) => salvarCampo("imagem_path", p)} />
        </>
      )}

      {bloco.tipo === "imagem" && (
        <>
          <ImagemDoBloco bucket={bucket} path={texto("imagem_path")} onSubir={onSubirImagem} onSalvar={(p) => salvarCampo("imagem_path", p)} />
          <Campo label="Descrição (acessibilidade)" valor={texto("alt")} onSalvar={(v) => salvarCampo("alt", v)} />
        </>
      )}

      {bloco.tipo === "agenda" && (
        <>
          <Campo label="Título do grupo" valor={texto("titulo")} onSalvar={(v) => salvarCampo("titulo", v)} />
          <label className="block text-xs text-gray-400 space-y-1">
            <span>Espetáculo (vazio = todos os shows do artista)</span>
            <select
              value={espetaculoEscolhido}
              onChange={(e) => salvarCampo("espetaculo", e.target.value)}
              className="w-full px-3 py-2 rounded-md bg-gray-800 border border-gray-700 text-white text-sm"
            >
              <option value="">Todos</option>
              {espetaculos.map((e) => <option key={e.nome} value={e.nome}>{e.nome}</option>)}
            </select>
          </label>
          {/* Bloco de agenda que não casa com nenhum show é invisível na
              página e não dá erro nenhum — então a contagem aparece aqui. */}
          <p className={`text-xs ${quantos > 0 ? "text-gray-500" : "text-amber-400"}`}>
            {artistaDaPagina
              ? quantos > 0
                ? `${quantos} show(s) no ar entram neste bloco`
                : "Nenhum show no ar para este filtro — o bloco não vai aparecer na página"
              : "Defina o artista da página acima para este bloco ter o que mostrar"}
          </p>
        </>
      )}
    </div>
  );
}

function ImagemDoBloco({
  bucket, path, onSubir, onSalvar,
}: { bucket: string; path: string; onSubir: (f: File) => Promise<string | null>; onSalvar: (p: string) => void }) {
  return (
    <div className="flex items-center gap-3">
      {path && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`${bucket}/${path}`} alt="" className="h-12 w-20 rounded object-cover" />
      )}
      <label className="text-xs text-gray-400">
        <span className="block mb-1">Imagem (JPEG, PNG ou WebP, até 5MB)</span>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            const p = await onSubir(f);
            if (p) onSalvar(p);
          }}
          className="text-xs text-gray-300"
        />
      </label>
    </div>
  );
}

/** Campo que salva ao sair (blur): salvar a cada tecla faria um request por letra. */
function Campo({
  label, valor, onSalvar, multilinha,
}: { label: string; valor: string; onSalvar: (v: string) => void; multilinha?: boolean }) {
  const [local, setLocal] = useState(valor);
  const comum = {
    value: local,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setLocal(e.target.value),
    onBlur: () => { if (local !== valor) onSalvar(local); },
    className: "w-full px-3 py-2 rounded-md bg-gray-800 border border-gray-700 text-white text-sm",
  };
  return (
    <label className="block text-xs text-gray-400 space-y-1">
      <span>{label}</span>
      {multilinha ? <textarea rows={3} {...comum} /> : <input {...comum} />}
    </label>
  );
}

function Cor({ label, valor, onSalvar }: { label: string; valor: string; onSalvar: (v: string) => void }) {
  return (
    <label className="block text-xs text-gray-400 space-y-1">
      <span>{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={valor}
          onChange={(e) => onSalvar(e.target.value)}
          className="h-9 w-12 rounded bg-gray-800 border border-gray-700"
        />
        <span className="font-mono text-gray-500">{valor}</span>
      </div>
    </label>
  );
}
