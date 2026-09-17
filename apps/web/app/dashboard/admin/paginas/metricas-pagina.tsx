"use client";

import { Suspense, use, useMemo, useState } from "react";

// Métricas de uma página pública.
//
// Três perguntas, nesta ordem de utilidade: quantos abriram, quantos clicaram
// (e a taxa entre os dois, que diz se o problema é o botão ou o alcance), e
// QUAL CIDADE/DATA recebe mais clique — que é a que o Linktree não responde e
// a que decide onde anunciar.

interface Metricas {
  dias: number;
  visitas: number;
  cliques: number;
  por_bloco: { bloco_id: string; tipo: string; rotulo: string; ativo: boolean; cliques: number }[];
  por_show: { show_id: string; cidade: string | null; teatro: string | null; data_show: string | null; status_venda: string | null; cliques: number }[];
  serie: { dia: string; visitas: number; cliques: number }[];
}

const PERIODOS = [7, 30, 90];

type Resposta = Metricas | { erro: string };

/**
 * Busca as métricas com `use()` + promessa memorizada, e não com
 * useEffect + setState.
 *
 * Não é preferência de estilo: `setState` dentro de efeito é o que a regra
 * `react-hooks/set-state-in-effect` proíbe, e já existe uma dívida desse
 * erro no repo (costs-dashboard.tsx) — somar a segunda tornaria o `npx
 * eslint` inútil como sinal. O erro da requisição vira valor em vez de
 * exceção para não precisar de error boundary só para isto.
 */
function buscar(paginaId: string, dias: number): Promise<Resposta> {
  return fetch(`/api/paginas/${paginaId}/metricas?dias=${dias}`)
    .then(async (res) => {
      const json = await res.json();
      if (!res.ok) return { erro: (json as { error?: string }).error ?? `Erro ${res.status}` };
      return json as Metricas;
    })
    .catch((e) => ({ erro: e instanceof Error ? e.message : String(e) }));
}

export default function MetricasPagina({ paginaId, slug }: { paginaId: string; slug: string }) {
  const [dias, setDias] = useState(30);
  // A promessa é recriada só quando página ou período mudam; `use()` a lê.
  const promessa = useMemo(() => buscar(paginaId, dias), [paginaId, dias]);

  return (
    <section className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium text-white">Métricas de /a/{slug}</p>
        <div className="flex gap-1">
          {PERIODOS.map((p) => (
            <button
              key={p}
              onClick={() => setDias(p)}
              className={`text-xs px-2 py-1 rounded ${
                p === dias ? "bg-gray-800 text-white" : "text-gray-500 hover:text-white"
              }`}
            >
              {p}d
            </button>
          ))}
        </div>
      </div>

      <Suspense fallback={<p className="text-xs text-gray-500">carregando...</p>}>
        <Conteudo promessa={promessa} />
      </Suspense>
    </section>
  );
}

function Conteudo({ promessa }: { promessa: Promise<Resposta> }) {
  const resposta = use(promessa);
  if ("erro" in resposta) return <p className="text-xs text-red-400">{resposta.erro}</p>;
  const dados = resposta;

  const taxa = dados.visitas > 0
    ? Math.round((dados.cliques / dados.visitas) * 1000) / 10
    : null;

  const picoSerie = Math.max(1, ...dados.serie.map((d) => Math.max(d.visitas, d.cliques)));

  return (
    <>
          <div className="grid grid-cols-3 gap-3">
            <Numero titulo="Aberturas" valor={dados.visitas} />
            <Numero titulo="Cliques" valor={dados.cliques} />
            <Numero
              titulo="Taxa de clique"
              valor={taxa === null ? "—" : `${taxa}%`}
              // Sem abertura registrada, taxa não existe — mostrar 0% daria a
              // impressão de que ninguém clicou, quando ninguém abriu.
              nota={taxa === null ? "sem aberturas no período" : undefined}
            />
          </div>

          {/* "Aberturas" e não "visitantes": não guardamos identificador de
              visitante, então o número é de aberturas de página. É escolha,
              não limitação — ver a nota abaixo. */}
          <p className="text-[11px] text-gray-600">
            Aberturas contam a página sendo aberta (uma por aba). Não há
            identificação de visitante: nenhum cookie, IP ou user-agent é guardado.
          </p>

          {dados.serie.length > 1 && (
            <div>
              <p className="text-xs text-gray-400 mb-2">Por dia</p>
              <div className="flex items-end gap-[3px] h-20">
                {dados.serie.map((d) => (
                  <div key={d.dia} className="flex-1 flex flex-col justify-end gap-[2px]" title={`${new Date(d.dia).toLocaleDateString("pt-BR")}: ${d.visitas} abertura(s), ${d.cliques} clique(s)`}>
                    <div className="bg-green-600/80" style={{ height: `${(d.cliques / picoSerie) * 100}%` }} />
                    <div className="bg-gray-700" style={{ height: `${(d.visitas / picoSerie) * 100}%` }} />
                  </div>
                ))}
              </div>
              <div className="flex gap-3 mt-1 text-[11px] text-gray-500">
                <span className="flex items-center gap-1"><i className="inline-block w-2 h-2 bg-gray-700" /> aberturas</span>
                <span className="flex items-center gap-1"><i className="inline-block w-2 h-2 bg-green-600/80" /> cliques</span>
              </div>
            </div>
          )}

          <div>
            <p className="text-xs text-gray-400 mb-2">Por botão</p>
            <div className="space-y-1">
              {dados.por_bloco.filter((b) => b.tipo !== "texto" && b.tipo !== "imagem").map((b) => (
                <div key={b.bloco_id} className="flex items-center justify-between text-xs">
                  <span className="text-gray-300 truncate">
                    {b.rotulo}
                    {!b.ativo && <span className="text-gray-600"> (escondido)</span>}
                  </span>
                  <span className="text-gray-400 shrink-0 ml-3">{b.cliques}</span>
                </div>
              ))}
              {dados.por_bloco.length === 0 && <p className="text-xs text-gray-600">nenhum bloco</p>}
            </div>
          </div>

          <div>
            <p className="text-xs text-gray-400 mb-2">
              Datas mais clicadas
              <span className="text-gray-600"> · onde a demanda está</span>
            </p>
            {dados.por_show.length === 0 ? (
              <p className="text-xs text-gray-600">nenhum clique em data ainda</p>
            ) : (
              <div className="space-y-1">
                {dados.por_show.slice(0, 10).map((s) => (
                  <div key={s.show_id} className="flex items-center justify-between text-xs">
                    <span className="text-gray-300 truncate">
                      {s.cidade ?? "—"}
                      {s.data_show && (
                        <span className="text-gray-500">
                          {" · "}
                          {new Date(s.data_show).toLocaleDateString("pt-BR", {
                            timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit",
                          })}
                        </span>
                      )}
                      {s.status_venda && <span className="text-gray-600"> · {s.status_venda}</span>}
                    </span>
                    <span className="text-gray-400 shrink-0 ml-3">{s.cliques}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
    </>
  );
}

function Numero({ titulo, valor, nota }: { titulo: string; valor: number | string; nota?: string }) {
  return (
    <div className="bg-gray-800/50 rounded-md px-3 py-2">
      <p className="text-[11px] text-gray-500">{titulo}</p>
      <p className="text-lg text-white">{valor}</p>
      {nota && <p className="text-[11px] text-gray-600">{nota}</p>}
    </div>
  );
}
