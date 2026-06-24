"use client"
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function RegisterPage() {
  const router = useRouter()
  const [companyName, setCompanyName] = useState('')
  const [userName, setUserName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (password !== confirmPassword) { setError('As senhas não coincidem'); return }
    if (password.length < 8) { setError('A senha deve ter no mínimo 8 caracteres'); return }
    setLoading(true)
    try {
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyName, userName, email, password }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Erro ao criar conta'); return }
      router.push('/login?registered=1')
    } catch {
      setError('Erro de conexão')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <h1 className="text-2xl font-bold text-white mb-2">Criar conta</h1>
        <p className="text-gray-400 mb-6">Comece a monitorar suas comunicações WhatsApp</p>
        <form onSubmit={handleSubmit} className="bg-gray-800 rounded-xl p-6 space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Nome da empresa</label>
            <input
              type="text" required value={companyName} onChange={e => setCompanyName(e.target.value)}
              className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-green-500"
              placeholder="Minha Empresa LTDA"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Seu nome</label>
            <input
              type="text" required value={userName} onChange={e => setUserName(e.target.value)}
              className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-green-500"
              placeholder="João Silva"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Email</label>
            <input
              type="email" required value={email} onChange={e => setEmail(e.target.value)}
              className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-green-500"
              placeholder="joao@empresa.com"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Senha</label>
            <input
              type="password" required value={password} onChange={e => setPassword(e.target.value)}
              className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-green-500"
              placeholder="Mínimo 8 caracteres"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Confirmar senha</label>
            <input
              type="password" required value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
              className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button
            type="submit" disabled={loading}
            className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-medium py-2 rounded-lg transition-colors"
          >
            {loading ? 'Criando conta...' : 'Criar conta'}
          </button>
          <p className="text-center text-gray-400 text-sm">
            Já tem conta?{' '}
            <Link href="/login" className="text-green-400 hover:underline">Entrar</Link>
          </p>
        </form>
      </div>
    </div>
  )
}
