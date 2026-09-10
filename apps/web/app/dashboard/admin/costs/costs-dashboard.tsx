"use client";

import { useCallback, useEffect, useState } from "react";
import { formatCurrency } from "@/lib/utils";

interface SessionOpt {
  id: string;
  label: string | null;
  phone_number: string | null;
  channel: string | null;
}

interface Bucket { messages: number; cost: number }
interface CategoryBucket extends Bucket { category: string }
interface TypeBucket extends Bucket { type: string }
interface DayBucket extends Bucket { day: string }
interface SessionBucket extends Bucket { sessionId: string | null; label: string }
interface CampaignBucket extends Bucket { campaignId: string; name: string; templateCategory: string | null; delivered: number }

interface CostsData {
  total: number;
  messages: number;
  billableMessages: number;
  freeMessages: number;
  unratedMessages: number;
  savedByWindow: number;
  byCategory: CategoryBucket[];
  byPricingType: TypeBucket[];
  byDay: DayBucket[];
  bySession: SessionBucket[];
  byCampaign: CampaignBucket[];
  projection: {
    effectiveFrom: string;
    total: number;
    delta: number;
    newlyBillable: number;
    estimated: boolean;
  };
  ledgerStart: string | null;
}

interface MetaData {
  totalCost: number;
  totalVolume: number;
  byCategory: { category: string; messages: number; cost: number }[];
  approximate: boolean;
  errors: string[];
}

const CATEGORY_LABEL: Record<string, string> = {
  marketing: "Marketing",
  utility: "Utilidade",
  authentication: "Autenticação",
  service: "Serviço",
  desconhecida: "Sem categoria",
};

const TYPE_LABEL: Record<string, string> = {
  regular: "Cobrada",
  free_customer_service: "Grátis — janela de atendimento (24h)",
  free_entry_point: "Grátis — entrada por anúncio (72h)",
  desconhecido: "Sem classificação",
};

type PeriodKey = "hoje" | "7d" | "30d" | "mes" | "mesPassado";

const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "hoje", label: "Hoje" },
  { key: "7d", label: "7 dias" },
  { key: "30d", label: "30 dias" },
  { key: "mes", label: "Mês atual" },
  { key: "mesPassado", label: "Mês passado" },
];

/** Janela [from, to) do período. `to` é exclusivo — a RPC usa `< to`. */
function periodRange(key: PeriodKey): { from: Date; to: Date; mesFechado: boolean } {
  const agora = new Date();
  const inicioDoDia = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
  const amanha = new Date(inicioDoDia); amanha.setDate(amanha.getDate() + 1);

  switch (key) {
    case "hoje":
      return { from: inicioDoDia, to: amanha, mesFechado: false };
    case "7d": {
      const from = new Date(inicioDoDia); from.setDate(from.getDate() - 6);
      return { from, to: amanha, mesFechado: false };
    }
    case "30d": {
      const from = new Date(inicioDoDia); from.setDate(from.getDate() - 29);
      return { from, to: amanha, mesFechado: false };
    }
    case "mes":
      return { from: new Date(agora.getFullYear(), agora.getMonth(), 1), to: amanha, mesFechado: false };
    case "mesPassado":
      return {
        from: new Date(agora.getFullYear(), agora.getMonth() - 1, 1),
        to: new Date(agora.getFullYear(), agora.getMonth(), 1),
        // Único período em que a franquia mensal de mensagem de serviço
        // (1.000 por número) pode ser contada por inteiro.
        mesFechado: true,
      };
  }
}

export default function CostsDashboard({ sessions }: { sessions: SessionOpt[] }) {
  const [period, setPeriod] = useState<PeriodKey>("30d");
  const [sessionId, setSessionId] = useState("all");
  const [data, setData] = useState<CostsData | null>(null);
  const [meta, setMeta] = useState<MetaData | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro(null);
    const { from, to } = periodRange(period);
    const qs = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
    if (sessionId !== "all") qs.set("sessionId", sessionId);

    try {
      const res = await fetch(`/api/costs?${qs}`, { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: string } | null;
        setErro(body?.error ?? "Não foi possível carregar os custos");
        setData(null);
        return;
      }
      setData(await res.json() as CostsData);
    } finally {
      setLoading(false);
    }

    // Conferência da Meta é carregada depois e nunca derruba a tela:
    // Graph API fora do ar não pode esconder o ledger local.
    setMeta(null);
    setMetaError(null);
    try {
      const res = await fetch(`/api/costs/meta?${new URLSearchParams({ from: from.toISOString(), to: to.toISOString() })}`, { cache: "no-store" });
      if (res.ok) setMeta(await res.json() as MetaData);
      else {
        const body = await res.json().catch(() => null) as { error?: string } | null;
        setMetaError(body?.error ?? "Meta não respondeu");
      }
    } catch {
      setMetaError("Meta não respondeu");
    }
  }, [period, sessionId]);

  useEffect(() => { void carregar(); }, [carregar]);

  const cloudSessions = sessions.filter((s) => s.channel === "cloud_api");
  const sessionLabel = (s: SessionOpt) => s.label || s.phone_number || s.id.slice(0, 8);
  const maxDia = Math.max(...(data?.byDay ?? []).map((d) => d.cost), 0.0001);
  const { mesFechado } = periodRange(period);

  return (
    <div className="space-y-6">
      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 bg-gray-800 rounded-lg p-1">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={`text-xs px-3 py-1.5 rounded-md transition-colors ${
                period === p.key ? "bg-gray-700 text-white" : "text-gray-400 hover:text-gray-200"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {cloudSessions.length > 0 && (
          <select
            value={sessionId}
            onChange={(e) => setSessionId(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-green-500"
          >
            <option value="all">Todos os números</option>
            {cloudSessions.map((s) => (
              <option key={s.id} value={s.id}>{sessionLabel(s)}</option>
            ))}
          </select>
        )}

        {loading && <span className="text-xs text-gray-500 animate-pulse">Carregando...</span>}
      </div>

      {erro && (
        <div className="bg-red-950/40 border border-red-900 rounded-xl p-4 text-sm text-red-300">{erro}</div>
      )}

      {data && (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <Card label="Custo no período" value={formatCurrency(data.total)} />
            <Card label="Mensagens cobradas" value={data.billableMessages.toLocaleString("pt-BR")} sub={`de ${data.messages.toLocaleString("pt-BR")} enviadas`} />
            <Card label="Mensagens grátis" value={data.freeMessages.toLocaleString("pt-BR")} sub="janela de 24h / 72h" />
            <Card
              label="Economizado pela janela"
              value={formatCurrency(data.savedByWindow)}
              sub="tarifa cheia que não foi cobrada"
            />
          </div>

          {data.unratedMessages > 0 && (
            <p className="text-xs text-yellow-500/90">
              {data.unratedMessages.toLocaleString("pt-BR")} mensagem(ns) cobrada(s) pela Meta sem tarifa
              cadastrada aqui (país fora do rate card local) — entram como zero, então o total está
              subestimado nesse tanto.
            </p>
          )}

          {/* Virada de 01/10/2026 */}
          <section className="bg-gray-800 rounded-xl p-5 border border-orange-900/50">
            <div className="flex items-baseline justify-between flex-wrap gap-2">
              <h2 className="text-white font-semibold">
                A partir de 01/10/2026
                {data.projection.estimated && (
                  <span className="ml-2 text-xs font-normal text-orange-400">estimativa</span>
                )}
              </h2>
              <span className="text-xs text-gray-500">mesmo volume, regras novas</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
              <Card label="Custo do período" value={formatCurrency(data.total)} plain />
              <Card label="Custaria nas regras novas" value={formatCurrency(data.projection.total)} plain />
              <Card
                label="Diferença"
                value={`${data.projection.delta >= 0 ? "+" : ""}${formatCurrency(data.projection.delta)}`}
                sub={data.total > 0 ? `${Math.round((data.projection.delta / data.total) * 100)}% a mais` : undefined}
                plain
                accent={data.projection.delta > 0 ? "text-orange-400" : undefined}
              />
            </div>
            <p className="text-xs text-gray-500 mt-3">
              {data.projection.newlyBillable.toLocaleString("pt-BR")} mensagem(ns) que hoje são grátis
              passam a ser cobradas: resposta livre dentro da janela de 24h (com franquia de 1.000 por
              número por mês) e template de utilidade dentro da janela, que perde a gratuidade.
              {!mesFechado && " A franquia é contada dentro do período selecionado — escolha “Mês passado” para o número fechado."}
            </p>
          </section>

          {/* Custo por dia */}
          <section className="bg-gray-800 rounded-xl p-5">
            <h2 className="text-white font-semibold mb-4">Custo por dia</h2>
            {data.byDay.length === 0 ? (
              <p className="text-xs text-gray-500 py-6 text-center">Nenhum disparo registrado no período.</p>
            ) : (
              <div className="flex items-end gap-1" style={{ height: 120 }}>
                {data.byDay.map((d) => (
                  <div key={d.day} className="flex-1 flex flex-col items-center gap-1" title={`${d.day}: ${formatCurrency(d.cost)} · ${d.messages} msg`}>
                    <div className="w-full flex items-end" style={{ height: 88 }}>
                      <div
                        className="w-full rounded-t bg-green-500/80"
                        style={{ height: `${Math.max(Math.round((d.cost / maxDia) * 100), d.cost > 0 ? 4 : 0)}%` }}
                      />
                    </div>
                    <span className="text-xs text-gray-500">{d.day.slice(8)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Breakdown
              title="Por categoria"
              rows={data.byCategory.map((c) => ({
                key: c.category,
                label: CATEGORY_LABEL[c.category] ?? c.category,
                messages: c.messages,
                cost: c.cost,
              }))}
            />
            <Breakdown
              title="Cobrança"
              rows={data.byPricingType.map((t) => ({
                key: t.type,
                label: TYPE_LABEL[t.type] ?? t.type,
                messages: t.messages,
                cost: t.cost,
              }))}
            />
          </div>

          {data.bySession.length > 0 && (
            <Breakdown
              title="Por número"
              rows={data.bySession.map((s) => ({
                key: s.sessionId ?? s.label,
                label: s.label,
                messages: s.messages,
                cost: s.cost,
              }))}
            />
          )}

          {/* Campanhas */}
          {data.byCampaign.length > 0 && (
            <section className="bg-gray-800 rounded-xl p-5">
              <h2 className="text-white font-semibold mb-4">Custo por campanha</h2>
              <div className="space-y-3">
                {data.byCampaign.map((c) => (
                  <div key={c.campaignId} className="flex items-baseline justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm text-gray-300 truncate">{c.name}</p>
                      <p className="text-xs text-gray-500">
                        {c.messages.toLocaleString("pt-BR")} disparos
                        {c.templateCategory ? ` · ${c.templateCategory.toLowerCase()}` : ""}
                        {c.delivered > 0 && ` · ${formatCurrency(c.cost / c.delivered)} por entrega`}
                      </p>
                    </div>
                    <span className="text-sm text-white tabular-nums shrink-0">{formatCurrency(c.cost)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Conferência com a Meta */}
          <section className="bg-gray-800 rounded-xl p-5">
            <h2 className="text-white font-semibold mb-1">Conferência com a Meta</h2>
            <p className="text-xs text-gray-500 mb-4">
              Agregado oficial (pricing_analytics). A Meta avisa que o valor é aproximado e pode
              divergir da fatura; WABA faturada por Solution Partner não devolve custo nenhum.
            </p>
            {metaError && <p className="text-xs text-yellow-500/90">{metaError}</p>}
            {meta && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Card label="Meta (aproximado)" value={formatCurrency(meta.totalCost)} plain />
                <Card label="Ledger local" value={formatCurrency(data.total)} plain />
                <Card
                  label="Diferença"
                  value={formatCurrency(meta.totalCost - data.total)}
                  plain
                />
              </div>
            )}
            {meta && meta.errors.length > 0 && (
              <p className="text-xs text-yellow-500/90 mt-3">{meta.errors.join(" · ")}</p>
            )}
          </section>

          <p className="text-xs text-gray-600">
            {data.ledgerStart
              ? `O registro de custo por mensagem começa em ${new Date(data.ledgerStart).toLocaleDateString("pt-BR")} — disparos anteriores não têm como ser recuperados e aparecem só na conferência da Meta.`
              : "Nenhum custo registrado ainda: o registro só vale para disparos posteriores ao deploy desta funcionalidade."}
          </p>
        </>
      )}
    </div>
  );
}

function Card({ label, value, sub, plain, accent }: {
  label: string; value: string; sub?: string; plain?: boolean; accent?: string;
}) {
  return (
    <div className={plain ? "" : "bg-gray-800 rounded-xl p-5"}>
      <p className="text-gray-400 text-sm">{label}</p>
      <p className={`text-2xl font-bold mt-1 tabular-nums ${accent ?? "text-white"}`}>{value}</p>
      {sub && <p className="text-gray-500 text-xs mt-1">{sub}</p>}
    </div>
  );
}

function Breakdown({ title, rows }: {
  title: string;
  rows: { key: string; label: string; messages: number; cost: number }[];
}) {
  const max = Math.max(...rows.map((r) => r.cost), 0.0001);
  return (
    <section className="bg-gray-800 rounded-xl p-5">
      <h2 className="text-white font-semibold mb-4">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-xs text-gray-500 py-4 text-center">Sem dados no período.</p>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.key}>
              <div className="flex justify-between text-sm mb-1 gap-3">
                <span className="text-gray-300 truncate">{r.label}</span>
                <span className="text-gray-400 tabular-nums shrink-0">
                  {formatCurrency(r.cost)}
                  <span className="text-gray-600"> · {r.messages.toLocaleString("pt-BR")}</span>
                </span>
              </div>
              <div className="w-full bg-gray-700 rounded-full h-1.5">
                <div className="bg-blue-500 h-1.5 rounded-full transition-all" style={{ width: `${Math.round((r.cost / max) * 100)}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
