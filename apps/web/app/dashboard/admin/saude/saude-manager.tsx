"use client";

import { Suspense, use, useMemo, useState } from "react";
import { toast } from "sonner";

interface Erro {
  assinatura: string;
  event_type: string;
  amostra: string | null;
  ocorrencias: number;
  primeiro: string;
  ultimo: string;
  reconhecido: boolean;
  novo_desde_ack: number;
}

const PERIODOS: { horas: number; rotulo: string }[] = [
  { horas: 24, rotulo: "24h" },
  { horas: 168, rotulo: "7d" },
  { horas: 720, rotulo: "30d" },
];

function buscar(horas: number): Promise<{ erros: Erro[] } | { erro: string }> {
  return fetch(`/api/saude?horas=${horas}`)
    .then(async (res) => {
      const json = await res.json();
      if (!res.ok) return { erro: (json as { error?: string }).error ?? `Erro ${res.status}` };
      return json as { erros: Erro[] };
    })
    .catch((e) => ({ erro: e instanceof Error ? e.message : String(e) }));
}

export default function SaudeManager({ iniciais, temWebhook }: { iniciais: Erro[]; temWebhook: boolean }) {
  const [horas, setHoras] = useState(24);
  const [versao, setVersao] = useState(0);
  // `use()` com promessa memorizada, e não useEffect + setState: é o padrão
  // que o repo adotou para não somar mais um erro de lint.
  const promessa = useMemo(
    () => (horas === 24 && versao === 0 ? Promise.resolve({ erros: iniciais }) : buscar(horas)),
    [horas, versao, iniciais],
  );

  async function reconhecer(assinatura: string, desfazer: boolean) {
    const res = await fetch("/api/saude/reconhecer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assinatura, desfazer }),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      toast.error((json as { error?: string }).error ?? "Falha ao reconhecer");
      return;
    }
    setVersao((v) => v + 1);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex gap-1">
          {PERIODOS.map((p) => (
            <button
              key={p.horas}
              onClick={() => { setHoras(p.horas); setVersao((v) => v + 1); }}
              className={`text-xs px-2 py-1 rounded ${
                p.horas === horas ? "bg-gray-800 text-white" : "text-gray-500 hover:text-white"
              }`}
            >
              {p.rotulo}
            </button>
          ))}
        </div>
        {!temWebhook && (
          // Sem integração de webhook, o cron não tem para onde avisar — e a
          // vigilância vira "alguém precisa abrir esta tela", que é o
          // problema que ela existe para resolver.
          <span className="text-xs text-amber-400">
            nenhum webhook ativo em Integrações — o aviso de hora em hora não sai
          </span>
        )}
      </div>

      <Suspense fallback={<p className="text-sm text-gray-500">carregando...</p>}>
        <Lista promessa={promessa} onReconhecer={reconhecer} />
      </Suspense>
    </div>
  );
}

function Lista({
  promessa, onReconhecer,
}: {
  promessa: Promise<{ erros: Erro[] } | { erro: string }>;
  onReconhecer: (assinatura: string, desfazer: boolean) => void;
}) {
  const resposta = use(promessa);
  if ("erro" in resposta) return <p className="text-sm text-red-400">{resposta.erro}</p>;

  const erros = resposta.erros;
  if (erros.length === 0) {
    return <p className="text-sm text-gray-500">Nenhum erro no período. É o estado que a gente quer.</p>;
  }

  return (
    <div className="space-y-2">
      {erros.map((e) => {
        const novo = Number(e.novo_desde_ack) > 0;
        return (
          <div
            key={e.assinatura}
            className={`rounded-lg border p-4 space-y-2 ${
              novo ? "bg-gray-900 border-gray-800" : "bg-gray-900/40 border-gray-800/50 opacity-70"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm text-white">
                  <span className="text-gray-500">{e.event_type}</span>{" "}
                  <b>{Number(e.ocorrencias)}×</b>
                  {e.reconhecido && Number(e.novo_desde_ack) > 0 && (
                    <span className="text-amber-400"> · {Number(e.novo_desde_ack)} depois de reconhecido</span>
                  )}
                </p>
                {/* A amostra é uma mensagem REAL; a assinatura tem `#` no
                    lugar dos ids e serve para agrupar, não para investigar. */}
                <p className="text-xs text-gray-400 mt-1 break-words">{e.amostra ?? e.assinatura}</p>
                <p className="text-[11px] text-gray-600 mt-1">
                  de {new Date(e.primeiro).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}
                  {" a "}
                  {new Date(e.ultimo).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}
                </p>
              </div>
              <button
                onClick={() => onReconhecer(e.assinatura, e.reconhecido)}
                className="shrink-0 text-xs text-gray-400 hover:text-white"
              >
                {e.reconhecido ? "voltar a acompanhar" : "reconhecer"}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
