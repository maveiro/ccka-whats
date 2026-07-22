import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { displayChatName } from '@/lib/chat-display'

const PAGE = 1000
const MAX_PAGES = 200 // teto de segurança (200k msgs); acima disso migrar p/ RPC GROUP BY

export async function GET(req: NextRequest) {
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
  const sessionId = new URL(req.url).searchParams.get('sessionId') || null

  const now = new Date()
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0)
  const weekStart = new Date(now); weekStart.setDate(now.getDate() - 7)

  // Classificação de chats (grupo vs contato) por jid + filtro de número
  const chatMap = new Map<string, { isGroup: boolean }>()
  let groupChats = 0
  let contactChats = 0
  {
    let from = 0
    for (let p = 0; p < MAX_PAGES; p++) {
      let q = adminClient.from('chats').select('id, jid, session_id').eq('tenant_id', tenantId)
      if (sessionId) q = q.eq('session_id', sessionId)
      const { data } = await q.order('id', { ascending: true }).range(from, from + PAGE - 1)
      const rows = data ?? []
      for (const c of rows as Array<{ id: string; jid: string | null }>) {
        const isGroup = (c.jid ?? '').endsWith('@g.us')
        chatMap.set(c.id, { isGroup })
        if (isGroup) groupChats++; else contactChats++
      }
      if (rows.length < PAGE) break
      from += PAGE
    }
  }

  // Total de mensagens (com filtro de número) → base p/ paginar o scan
  let totalQ = adminClient.from('messages').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId)
  if (sessionId) totalQ = totalQ.eq('session_id', sessionId)
  const { count: totalMessages } = await totalQ

  // Scan completo de colunas leves, páginas paralelas. Atividade por `timestamp`.
  const total = totalMessages ?? 0
  const pages = Math.min(Math.ceil(total / PAGE), MAX_PAGES)
  const pageFetches = Array.from({ length: pages }, (_, p) => {
    let q = adminClient.from('messages').select('type, timestamp, chat_id').eq('tenant_id', tenantId)
    if (sessionId) q = q.eq('session_id', sessionId)
    return q.order('id', { ascending: true }).range(p * PAGE, p * PAGE + PAGE - 1)
  })
  const pageResults = await Promise.all(pageFetches)
  const rows = pageResults.flatMap((r) => r.data ?? []) as Array<{ type: string; timestamp: string; chat_id: string | null }>

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
  let groupMessages = 0
  let contactMessages = 0

  for (const m of rows) {
    const t = m.type ?? 'unknown'
    typeMap.set(t, (typeMap.get(t) ?? 0) + 1)

    const kind = m.chat_id ? chatMap.get(m.chat_id) : undefined
    if (kind?.isGroup) groupMessages++; else if (kind) contactMessages++

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

  // Top 5 conversas — resolver nomes + marcar se é grupo
  const top5 = Array.from(chatCountMap.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5)
  const top5Ids = top5.map(([id]) => id)
  const { data: topChatRows } = top5Ids.length
    ? await adminClient.from('chats').select('id, name, jid').in('id', top5Ids)
    : { data: [] as Array<{ id: string; name: string | null; jid: string }> }
  const chatInfo = new Map((topChatRows ?? []).map((c) => [c.id, c]))
  const topChats = top5.map(([id, count]) => {
    const c = chatInfo.get(id)
    const jid = c?.jid ?? id
    return { name: displayChatName(c?.name ?? null, jid), jid, count, isGroup: jid.endsWith('@g.us') }
  })

  return NextResponse.json({
    totalMessages: total,
    messagesToday,
    messagesThisWeek,
    totalChats: groupChats + contactChats,
    activeChats: activeSet.size,
    chatsByType: { groups: groupChats, contacts: contactChats },
    messagesByKind: { groups: groupMessages, contacts: contactMessages },
    messagesByDay,
    messagesByType,
    topChats,
    sessionId,
    ...(pages >= MAX_PAGES ? { truncated: true } : {}),
  })
}
