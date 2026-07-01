"use client"

import { useState } from "react"

export interface AnalyticsData {
  totalMessages: number
  messagesToday: number
  messagesThisWeek: number
  totalChats: number
  activeChats: number
  chatsByType: { groups: number; contacts: number }
  messagesByKind: { groups: number; contacts: number }
  messagesByDay: { date: string; count: number }[]
  messagesByType: { type: string; count: number }[]
  topChats: { name: string; jid: string; count: number; isGroup?: boolean }[]
}

interface SessionOpt {
  id: string
  label: string | null
  phone_number: string | null
}

const TYPE_LABELS: Record<string, string> = {
  text:        "Texto",
  image:       "Imagem",
  video:       "Vídeo",
  audio:       "Áudio",
  ptt:         "Áudio (PTT)",
  document:    "Documento",
  sticker:     "Sticker",
  location:    "Localização",
  contact:     "Contato",
  poll:        "Enquete",
  reaction:    "Reação",
  interactive: "Interativa",
}

export function AnalyticsDashboard({ initialData, sessions }: { initialData: AnalyticsData; sessions: SessionOpt[] }) {
  const [data, setData] = useState<AnalyticsData>(initialData)
  const [sessionId, setSessionId] = useState<string>("all")
  const [loading, setLoading] = useState(false)
  const [hoveredDay, setHoveredDay] = useState<string | null>(null)

  const maxDayCount   = Math.max(...data.messagesByDay.map(d => d.count), 1)
  const maxTypeCount  = Math.max(...data.messagesByType.map(t => t.count), 1)
  const maxChatCount  = Math.max(...data.topChats.map(c => c.count), 1)

  async function applyFilter(sid: string) {
    setSessionId(sid)
    setLoading(true)
    try {
      const qs = sid === "all" ? "" : `?sessionId=${encodeURIComponent(sid)}`
      const res = await fetch(`/api/analytics${qs}`, { cache: "no-store" })
      if (res.ok) setData(await res.json() as AnalyticsData)
    } finally {
      setLoading(false)
    }
  }

  const sessionLabel = (s: SessionOpt) => s.label || s.phone_number || s.id.slice(0, 8)

  return (
    <div className={`space-y-6 ${loading ? "opacity-60 pointer-events-none transition-opacity" : ""}`}>
      {/* Filtro por número */}
      {sessions.length > 0 && (
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-400">Número:</label>
          <select
            value={sessionId}
            onChange={(e) => void applyFilter(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-md px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-green-500"
          >
            <option value="all">Todos os números</option>
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>{sessionLabel(s)}</option>
            ))}
          </select>
          {loading && <span className="text-xs text-gray-500 animate-pulse">Atualizando...</span>}
        </div>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Total de mensagens" value={data.totalMessages} />
        <StatCard label="Mensagens hoje"      value={data.messagesToday} />
        <StatCard
          label="Total de conversas"
          value={data.totalChats}
          sub={`${data.chatsByType.groups.toLocaleString("pt-BR")} grupos · ${data.chatsByType.contacts.toLocaleString("pt-BR")} contatos`}
        />
      </div>

      {/* Grupos vs Contatos */}
      <section className="bg-gray-800 rounded-xl p-5">
        <h2 className="text-white font-semibold mb-4">Grupos vs Contatos</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <SplitBar title="Conversas" groups={data.chatsByType.groups} contacts={data.chatsByType.contacts} />
          <SplitBar title="Mensagens" groups={data.messagesByKind.groups} contacts={data.messagesByKind.contacts} />
        </div>
      </section>

      {/* Messages by Day */}
      <section
        className="bg-gray-800 rounded-xl p-5"
        aria-labelledby="chart-by-day-title"
      >
        <h2 id="chart-by-day-title" className="text-white font-semibold mb-4">
          Mensagens por dia <span className="text-gray-500 font-normal text-sm">(últimos 14 dias)</span>
        </h2>

        {data.messagesByDay.length === 0 || data.messagesByDay.every(d => d.count === 0) ? (
          <EmptyChart message="Nenhuma mensagem registrada nos últimos 14 dias" />
        ) : (
          <div
            className="flex items-end gap-1"
            style={{ height: 120 }}
            role="img"
            aria-label={`Gráfico de barras: mensagens por dia nos últimos 14 dias. Máximo: ${maxDayCount} mensagens.`}
          >
            {data.messagesByDay.map(d => {
              const heightPct = Math.round((d.count / maxDayCount) * 100)
              const day = d.date.slice(8)
              const isHovered = hoveredDay === d.date
              return (
                <div
                  key={d.date}
                  className="flex-1 flex flex-col items-center gap-1 relative"
                  onMouseEnter={() => setHoveredDay(d.date)}
                  onMouseLeave={() => setHoveredDay(null)}
                  onFocus={() => setHoveredDay(d.date)}
                  onBlur={() => setHoveredDay(null)}
                >
                  {/* Tooltip */}
                  {isHovered && d.count > 0 && (
                    <div
                      className="absolute -top-9 left-1/2 -translate-x-1/2 bg-gray-700 border border-gray-600 text-white text-xs px-2 py-1 rounded whitespace-nowrap z-10 pointer-events-none"
                      role="tooltip"
                    >
                      {d.count.toLocaleString("pt-BR")} msg
                    </div>
                  )}
                  <div
                    className="w-full flex items-end"
                    style={{ height: 88 }}
                  >
                    <div
                      className={`w-full rounded-t transition-colors ${
                        isHovered && d.count > 0
                          ? "bg-green-400"
                          : "bg-green-500/80"
                      }`}
                      style={{ height: `${Math.max(heightPct, d.count > 0 ? 4 : 0)}%` }}
                      tabIndex={d.count > 0 ? 0 : -1}
                      aria-label={`${d.date}: ${d.count} mensagens`}
                    />
                  </div>
                  <span className="text-xs text-gray-500 select-none">{day}</span>
                </div>
              )
            })}
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Type Breakdown */}
        <section
          className="bg-gray-800 rounded-xl p-5"
          aria-labelledby="chart-by-type-title"
        >
          <h2 id="chart-by-type-title" className="text-white font-semibold mb-4">
            Tipos de mensagem
          </h2>
          {data.messagesByType.length === 0 ? (
            <EmptyChart message="Sem dados de tipos de mensagem" />
          ) : (
            <div className="space-y-3" role="list" aria-label="Distribuição por tipo de mensagem">
              {data.messagesByType.map(t => {
                const pct = Math.round((t.count / maxTypeCount) * 100)
                const label = TYPE_LABELS[t.type] ?? t.type
                return (
                  <div key={t.type} role="listitem">
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-gray-300">{label}</span>
                      <span className="text-gray-400 tabular-nums">{t.count.toLocaleString("pt-BR")}</span>
                    </div>
                    <div
                      className="w-full bg-gray-700 rounded-full h-1.5"
                      role="meter"
                      aria-valuenow={t.count}
                      aria-valuemax={maxTypeCount}
                      aria-label={`${label}: ${t.count} mensagens`}
                    >
                      <div
                        className="bg-blue-500 h-1.5 rounded-full transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {/* Top Chats */}
        <section
          className="bg-gray-800 rounded-xl p-5"
          aria-labelledby="chart-top-chats-title"
        >
          <h2 id="chart-top-chats-title" className="text-white font-semibold mb-4">
            Top 5 conversas
          </h2>
          {data.topChats.length === 0 ? (
            <EmptyChart message="Nenhuma conversa com mensagens ainda" />
          ) : (
            <div className="space-y-3" role="list" aria-label="Top 5 conversas por volume de mensagens">
              {data.topChats.map((c, i) => {
                const pct = Math.round((c.count / maxChatCount) * 100)
                return (
                  <div key={c.jid} className="flex items-center gap-3" role="listitem">
                    <span className="text-gray-600 text-sm tabular-nums w-4 shrink-0">{i + 1}.</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-gray-300 text-sm truncate">
                        {c.isGroup && <span className="text-xs text-gray-500 mr-1">[grupo]</span>}
                        {c.name || c.jid}
                      </p>
                      <div
                        className="w-full bg-gray-700 rounded-full h-1 mt-1"
                        role="meter"
                        aria-valuenow={c.count}
                        aria-valuemax={maxChatCount}
                        aria-label={`${c.name || c.jid}: ${c.count} mensagens`}
                      >
                        <div
                          className="bg-purple-500 h-1 rounded-full transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                    <span className="text-gray-400 text-sm tabular-nums shrink-0">
                      {c.count.toLocaleString("pt-BR")}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function StatCard({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="bg-gray-800 rounded-xl p-5">
      <p className="text-gray-400 text-sm">{label}</p>
      <p className="text-white text-3xl font-bold mt-1 tabular-nums">
        {value.toLocaleString("pt-BR")}
      </p>
      {sub && <p className="text-gray-500 text-xs mt-1">{sub}</p>}
    </div>
  )
}

function SplitBar({ title, groups, contacts }: { title: string; groups: number; contacts: number }) {
  const total = groups + contacts
  const gPct = total ? Math.round((groups / total) * 100) : 0
  const cPct = total ? 100 - gPct : 0
  return (
    <div>
      <p className="text-gray-400 text-sm mb-2">{title} <span className="text-gray-600">({total.toLocaleString("pt-BR")})</span></p>
      <div className="flex h-2.5 rounded-full overflow-hidden bg-gray-700">
        <div className="bg-emerald-500" style={{ width: `${gPct}%` }} title={`Grupos: ${groups}`} />
        <div className="bg-sky-500" style={{ width: `${cPct}%` }} title={`Contatos: ${contacts}`} />
      </div>
      <div className="flex justify-between mt-2 text-xs">
        <span className="text-emerald-400">Grupos: {groups.toLocaleString("pt-BR")} ({gPct}%)</span>
        <span className="text-sky-400">Contatos: {contacts.toLocaleString("pt-BR")} ({cPct}%)</span>
      </div>
    </div>
  )
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 gap-2">
      <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-500" aria-hidden="true">
          <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
        </svg>
      </div>
      <p className="text-xs text-gray-500 text-center">{message}</p>
    </div>
  )
}
