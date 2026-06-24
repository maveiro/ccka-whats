"use client"

interface AnalyticsData {
  totalMessages: number
  messagesToday: number
  messagesThisWeek: number
  totalChats: number
  activeChats: number
  messagesByDay: { date: string; count: number }[]
  messagesByType: { type: string; count: number }[]
  topChats: { name: string; jid: string; count: number }[]
}

export function AnalyticsDashboard({ data }: { data: AnalyticsData }) {
  const maxDayCount = Math.max(...data.messagesByDay.map(d => d.count), 1)
  const maxTypeCount = Math.max(...data.messagesByType.map(t => t.count), 1)
  const maxChatCount = Math.max(...data.topChats.map(c => c.count), 1)

  return (
    <div className="space-y-6">
      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Total Mensagens" value={data.totalMessages} />
        <StatCard label="Mensagens Hoje" value={data.messagesToday} />
        <StatCard label="Total Conversas" value={data.totalChats} />
      </div>

      {/* Messages by Day */}
      <div className="bg-gray-800 rounded-xl p-5">
        <h2 className="text-white font-semibold mb-4">Mensagens por Dia (últimos 14 dias)</h2>
        <div className="flex items-end gap-1 h-32">
          {data.messagesByDay.map(d => {
            const heightPct = Math.round((d.count / maxDayCount) * 100)
            const day = d.date.slice(8)
            return (
              <div key={d.date} className="flex-1 flex flex-col items-center gap-1">
                <span className="text-xs text-gray-400">{d.count > 0 ? d.count : ''}</span>
                <div className="w-full flex items-end" style={{ height: '80px' }}>
                  <div
                    className="w-full bg-green-500 rounded-t"
                    style={{ height: `${Math.max(heightPct, d.count > 0 ? 4 : 0)}%` }}
                  />
                </div>
                <span className="text-xs text-gray-500">{day}</span>
              </div>
            )
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Type Breakdown */}
        <div className="bg-gray-800 rounded-xl p-5">
          <h2 className="text-white font-semibold mb-4">Tipos de Mensagem</h2>
          <div className="space-y-3">
            {data.messagesByType.length === 0 && <p className="text-gray-500 text-sm">Sem dados</p>}
            {data.messagesByType.map(t => (
              <div key={t.type}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-300 capitalize">{t.type}</span>
                  <span className="text-gray-400">{t.count}</span>
                </div>
                <div className="w-full bg-gray-700 rounded-full h-1.5">
                  <div
                    className="bg-blue-500 h-1.5 rounded-full"
                    style={{ width: `${Math.round((t.count / maxTypeCount) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Top Chats */}
        <div className="bg-gray-800 rounded-xl p-5">
          <h2 className="text-white font-semibold mb-4">Top 5 Conversas</h2>
          <div className="space-y-3">
            {data.topChats.length === 0 && <p className="text-gray-500 text-sm">Sem dados</p>}
            {data.topChats.map((c, i) => (
              <div key={c.jid} className="flex items-center gap-3">
                <span className="text-gray-500 text-sm w-4">{i + 1}.</span>
                <div className="flex-1 min-w-0">
                  <p className="text-gray-300 text-sm truncate">{c.name}</p>
                  <div className="w-full bg-gray-700 rounded-full h-1 mt-1">
                    <div
                      className="bg-purple-500 h-1 rounded-full"
                      style={{ width: `${Math.round((c.count / maxChatCount) * 100)}%` }}
                    />
                  </div>
                </div>
                <span className="text-gray-400 text-sm">{c.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-gray-800 rounded-xl p-5">
      <p className="text-gray-400 text-sm">{label}</p>
      <p className="text-white text-3xl font-bold mt-1">{value.toLocaleString('pt-BR')}</p>
    </div>
  )
}
