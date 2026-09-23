"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import Button from "@/components/ui/button";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    if (error) {
      setError("Erro ao enviar email. Verifique o endereço e tente novamente.");
      setLoading(false);
      return;
    }

    setSent(true);
    setLoading(false);
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-950 light:bg-white">
      <div className="w-full max-w-sm space-y-6 px-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold text-white light:text-gray-900">Recuperar senha</h1>
          <p className="text-sm text-gray-400 light:text-gray-500">
            Enviaremos um link para redefinir sua senha
          </p>
        </div>

        {sent ? (
          <div className="space-y-4">
            <div className="bg-green-900/30 border border-green-800 rounded-md px-4 py-3 text-sm text-green-300">
              Email enviado. Verifique sua caixa de entrada e clique no link para redefinir sua senha.
            </div>
            <Link
              href="/login"
              className="block text-center text-sm text-gray-400 underline hover:text-white transition-colors light:text-gray-500 light:hover:text-gray-900"
            >
              ← Voltar para o login
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <label htmlFor="email" className="block text-xs font-medium text-gray-400 light:text-gray-500">
                Email
              </label>
              <input
                id="email"
                type="email"
                placeholder="seu@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                autoComplete="email"
                className="w-full px-3 py-2 rounded-md bg-gray-900 border border-gray-800 text-white placeholder-gray-600 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 focus:ring-offset-gray-950 light:bg-white light:border-gray-200 light:text-gray-900 light:placeholder-gray-400"
              />
            </div>

            {error && <p className="text-red-400 text-sm">{error}</p>}

            <Button type="submit" variant="primary" size="md" disabled={loading} className="w-full justify-center">
              {loading ? "Enviando..." : "Enviar link de recuperação"}
            </Button>

            <Link
              href="/login"
              className="block text-center text-sm text-gray-400 underline hover:text-gray-300 transition-colors light:text-gray-500 light:hover:text-gray-700"
            >
              ← Voltar para o login
            </Link>
          </form>
        )}
      </div>
    </main>
  );
}
