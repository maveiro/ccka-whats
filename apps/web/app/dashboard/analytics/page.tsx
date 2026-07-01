import { cookies, headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { AnalyticsDashboard, type AnalyticsData } from '@/components/analytics-dashboard'

const emptyData: AnalyticsData = {
  totalMessages: 0, messagesToday: 0, messagesThisWeek: 0,
  totalChats: 0, activeChats: 0,
  chatsByType: { groups: 0, contacts: 0 },
  messagesByKind: { groups: 0, contacts: 0 },
  messagesByDay: [], messagesByType: [], topChats: [],
}

export default async function AnalyticsPage() {
  const headersList = await headers()
  const host = headersList.get('host') ?? 'localhost:3000'
  const protocol = host.includes('localhost') ? 'http' : 'https'
  const cookieStore = await cookies()
  const cookieHeader = cookieStore.getAll().map(c => `${c.name}=${c.value}`).join('; ')

  // Lista de números (sessões) para o filtro
  const supabase = await createClient()
  const { data: sessions } = await supabase
    .from('wa_sessions')
    .select('id, label, phone_number')
    .order('created_at', { ascending: true })

  let data: AnalyticsData = emptyData
  try {
    const res = await fetch(`${protocol}://${host}/api/analytics`, {
      headers: { cookie: cookieHeader },
      cache: 'no-store',
    })
    if (res.ok) data = await res.json() as AnalyticsData
  } catch {
    // Return empty data on error
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-white mb-6">Analytics</h1>
      <AnalyticsDashboard initialData={data} sessions={sessions ?? []} />
    </div>
  )
}
