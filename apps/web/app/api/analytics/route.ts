import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

const PAGE = 1000
const MAX_PAGES = 200 // teto de segurança (200k msgs); acima disso migrar p/ RPC GROUP BY

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const adminClient = createAdminClient()

  const { data: operator } = await adminClient
    .from('operators')
    .select('tenant_id, role')
    .eq('id', user.id)
    .single()

  if (!operator) return NextResponse.json({ error: 'Operator not found' }, { status: 404 })
  if (operator.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const tenantId = operator.tenant_id
  const now = new Date()
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0)
  const weekStart = new Date(now); weekStart.setDate(now.getDate() - 7)

  // Contagens exatas (cards) + total para paginar o scan
  const [{ count: totalMessages }, { count: totalChats }] = await Promise.all([
    adminClient.from('messages').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId),
    adminClient.from('chats').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId),
  ])

  // Scan completo de colunas leves, em páginas paralelas (o cap de 1000 linhas
  // do PostgREST tornava os agregados errados). Atividade por `timestamp` (data
  // real da mensagem), não `created_at` (ingestão).
  const total = totalMessages ?? 0
  const pages = Math.min(Math.ceil(total / PAGE), MAX_PAGES)
  const pageFetches = Array.from({ length: pages }, (_, p) =>
    adminClient
      .from('messages')
      .select('type, timestamp, chat_id')
      .eq('tenant_id', tenantId)
      .order('id', { ascending: true })
      .range(p * PAGE, p * PAGE + PAGE - 1)
  )
  const pageResults = await Promise.all(pageFetches)
  const rows = pageResults.flatMap((r) => r.data ?? []) as Array<{ type: string; timestamp: string; chat_id: string | null }>

  // Janela de 14 dias (por data de timestamp)
  const dayMap = new Map<string, number>()
  for (let i = 0; i < 14; i++) {
    const d = new Date(now); d.setDate(now.getDate() - i)
    dayMap.set(d.toISOString().slice(0, 10), 0)
  }

  const todayIso = todayStart.toISOString()
  const weekIso = weekStart.toISOString()
  const typeMap = new Map<string, number>()
  const chatCountMap = new Map<string, number>()
  const activeSet = new Set<string>()
  let messagesToday = 0
  let messagesThisWeek = 0

  for (const m of rows) {
    const t = m.type ?? 'unknown'
    typeMap.set(t, (typeMap.get(t) ?? 0) + 1)

    const ts = m.timestamp
    if (ts) {
      const day = ts.slice(0, 10)
      if (dayMap.has(day)) dayMap.set(day, (dayMap.get(day) ?? 0) + 1)
      if (ts >= todayIso) messagesToday++
      if (ts >= weekIso) {
        messagesThisWeek++
        if (m.chat_id) activeSet.add(m.chat_id)
      }
    }
    if (m.chat_id) chatCountMap.set(m.chat_id, (chatCountMap.get(m.chat_id) ?? 0) + 1)
  }

  const messagesByDay = Array.from(dayMap.entries())
    .map(([date, count]) => ({ date, count }))
    .reverse()

  const messagesByType = Array.from(typeMap.entries())
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count)

  // Top 5 conversas — resolver nomes só dos 5 vencedores
  const top5 = Array.from(chatCountMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
  const top5Ids = top5.map(([id]) => id)
  const { data: topChatRows } = top5Ids.length
    ? await adminClient.from('chats').select('id, name, jid').in('id', top5Ids)
    : { data: [] as Array<{ id: string; name: string | null; jid: string }> }
  const chatInfo = new Map((topChatRows ?? []).map((c) => [c.id, c]))
  const topChats = top5.map(([id, count]) => {
    const c = chatInfo.get(id)
    return { name: c?.name ?? c?.jid ?? id, jid: c?.jid ?? id, count }
  })

  return NextResponse.json({
    totalMessages: total,
    messagesToday,
    messagesThisWeek,
    totalChats: totalChats ?? 0,
    activeChats: activeSet.size,
    messagesByDay,
    messagesByType,
    topChats,
    ...(pages >= MAX_PAGES ? { truncated: true } : {}),
  })
}
