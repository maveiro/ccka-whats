import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
}

export async function POST(request: Request) {
  let body: unknown
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { companyName, userName, email, password } = body as Record<string, string>

  if (!companyName || !userName || !email || !password) {
    return NextResponse.json({ error: 'Todos os campos são obrigatórios' }, { status: 400 })
  }
  if (password.length < 8) {
    return NextResponse.json({ error: 'A senha deve ter no mínimo 8 caracteres' }, { status: 400 })
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Email inválido' }, { status: 400 })
  }

  const adminClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Create auth user
  const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (authError || !authData.user) {
    return NextResponse.json({ error: authError?.message ?? 'Erro ao criar usuário' }, { status: 400 })
  }

  const userId = authData.user.id
  const slug = slugify(companyName)

  // Insert tenant
  const { data: tenant, error: tenantError } = await adminClient
    .from('tenants')
    .insert({ name: companyName, slug, plan: 'personal', active: true })
    .select('id')
    .single()

  if (tenantError || !tenant) {
    // Rollback user
    await adminClient.auth.admin.deleteUser(userId)
    return NextResponse.json({ error: tenantError?.message ?? 'Erro ao criar empresa' }, { status: 400 })
  }

  // Insert operator
  const { error: opError } = await adminClient
    .from('operators')
    .insert({ id: userId, tenant_id: tenant.id, name: userName, email, role: 'admin' })

  if (opError) {
    await adminClient.auth.admin.deleteUser(userId)
    await adminClient.from('tenants').delete().eq('id', tenant.id)
    return NextResponse.json({ error: opError.message }, { status: 400 })
  }

  return NextResponse.json({ success: true })
}
