"use client"
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Eye, EyeOff } from 'lucide-react'

export default function RegisterPage() {
  const router = useRouter()
  const [companyName, setCompanyName] = useState('')
  const [userName, setUserName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
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
          <div className="space-y-1">
            <label htmlFor="company-name" className="block text-xs font-medium text-gray-400">Nome da empresa</label>
            <input
              id="company-name"
              type="text" required value={companyName} onChange={e => setCompanyName(e.target.value)}
              className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 focus:ring-offset-gray-800 placeholder-gray-500 text-sm"
              placeholder="Minha Empresa LTDA"
              autoComplete="organization"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="user-name" className="block text-xs font-medium text-gray-400">Seu nome</label>
            <input
              id="user-name"
              type="text" required value={userName} onChange={e => setUserName(e.target.value)}
              className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 focus:ring-offset-gray-800 placeholder-gray-500 text-sm"
              placeholder="João Silva"
              autoComplete="name"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="email" className="block text-xs font-medium text-gray-400">Email</label>
            <input
              id="email"
              type="email" required value={email} onChange={e => setEmail(e.target.value)}
              className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 focus:ring-offset-gray-800 placeholder-gray-500 text-sm"
              placeholder="joao@empresa.com"
              autoComplete="email"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="password" className="block text-xs font-medium text-gray-400">Senha</label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'} required value={password} onChange={e => setPassword(e.target.value)}
                className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 pr-10 outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 focus:ring-offset-gray-800 placeholder-gray-500 text-sm"
                placeholder="Mínimo 8 caracteres"
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword(v => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors p-1"
                aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div className="space-y-1">
            <label htmlFor="confirm-password" className="block text-xs font-medium text-gray-400">Confirmar senha</label>
            <div className="relative">
              <input
                id="confirm-password"
                type={showConfirm ? 'text' : 'password'} required value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
                className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 pr-10 outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 focus:ring-offset-gray-800 placeholder-gray-500 text-sm"
                placeholder="Repita a senha"
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowConfirm(v => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors p-1"
                aria-label={showConfirm ? 'Ocultar confirmação' : 'Mostrar confirmação'}
              >
                {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
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
