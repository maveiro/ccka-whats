import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function GET() {
  // Get current user via SSR client
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return cookieStore.getAll() }, setAll() {} } }
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Use service role for data queries
  const adminClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Get tenant_id from operators
  const { data: operator } = await adminClient
    .from('operators')
    .select('tenant_id')
    .eq('id', user.id)
    .single()

  if (!operator) return NextResponse.json({ error: 'Operator not found' }, { status: 404 })

  const tenantId = operator.tenant_id
  const now = new Date()
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0)
  const weekStart = new Date(now); weekStart.setDate(now.getDate() - 7)
  const fourteenDaysAgo = new Date(now); fourteenDaysAgo.setDate(now.getDate() - 14)

  // Run queries in parallel
  const [
    { count: totalMessages },
    { count: messagesToday },
    { count: messagesThisWeek },
    { count: totalChats },
    { data: recentChats },
    { data: recentMessages },
    { data: typeMessages },
    { data: topChatsData },
  ] = await Promise.all([
    adminClient.from('messages').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId),
    adminClient.from('messages').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId).gte('created_at', todayStart.toISOString()),
    adminClient.from('messages').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId).gte('created_at', weekStart.toISOString()),
    adminClient.from('chats').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId),
    adminClient.from('messages').select('chat_id').eq('tenant_id', tenantId).gte('created_at', weekStart.toISOString()),
    adminClient.from('messages').select('created_at').eq('tenant_id', tenantId).gte('created_at', fourteenDaysAgo.toISOString()),
    adminClient.from('messages').select('type').eq('tenant_id', tenantId),
    adminClient.from('messages').select('chat_id, chats(name, jid)').eq('tenant_id', tenantId),
  ])

  // Active chats (unique chat_ids with messages in last 7 days)
  const activeChats = new Set((recentChats ?? []).map((m: { chat_id: string }) => m.chat_id)).size

  // Messages by day
  const dayMap = new Map<string, number>()
  for (let i = 0; i < 14; i++) {
    const d = new Date(now)
    d.setDate(now.getDate() - i)
    dayMap.set(d.toISOString().slice(0, 10), 0)
  }
  for (const msg of (recentMessages ?? [])) {
    const day = (msg.created_at as string).slice(0, 10)
    if (dayMap.has(day)) dayMap.set(day, (dayMap.get(day) ?? 0) + 1)
  }
  const messagesByDay = Array.from(dayMap.entries())
    .map(([date, count]) => ({ date, count }))
    .reverse()

  // Messages by type
  const typeMap = new Map<string, number>()
  for (const msg of (typeMessages ?? [])) {
    const t = (msg as { type: string }).type ?? 'unknown'
    typeMap.set(t, (typeMap.get(t) ?? 0) + 1)
  }
  const messagesByType = Array.from(typeMap.entries())
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count)

  // Top chats
  const chatCountMap = new Map<string, { name: string; jid: string; count: number }>()
  for (const msg of (topChatsData ?? [])) {
    const m = msg as unknown as { chat_id: string; chats: { name: string; jid: string }[] | null }
    const chatId = m.chat_id
    const chat = Array.isArray(m.chats) ? m.chats[0] ?? null : m.chats
    if (!chatCountMap.has(chatId)) {
      chatCountMap.set(chatId, { name: chat?.name ?? chatId, jid: chat?.jid ?? chatId, count: 0 })
    }
    chatCountMap.get(chatId)!.count++
  }
  const topChats = Array.from(chatCountMap.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)

  return NextResponse.json({
    totalMessages: totalMessages ?? 0,
    messagesToday: messagesToday ?? 0,
    messagesThisWeek: messagesThisWeek ?? 0,
    totalChats: totalChats ?? 0,
    activeChats,
    messagesByDay,
    messagesByType,
    topChats,
  })
}
