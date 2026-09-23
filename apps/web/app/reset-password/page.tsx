"use client";

import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Eye, EyeOff, LinkIcon } from "lucide-react";

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionReady, setSessionReady] = useState(false);

  useEffect(() => {
    const errorCode = searchParams.get("error_code");
    const code = searchParams.get("code");

    if (errorCode || !code) {
      setError("expired");
      return;
    }

    const supabase = createClient();
    supabase.auth.exchangeCodeForSession(code).then(({ error }) => {
      if (error) {
        setError("expired");
      } else {
        setSessionReady(true);
      }
    });
  }, [searchParams]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("As senhas não coincidem.");
      return;
    }
    if (password.length < 8) {
      setError("A senha deve ter no mínimo 8 caracteres.");
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setError("Erro ao redefinir senha. O link pode ter expirado — solicite um novo.");
      setLoading(false);
      return;
    }

    router.push("/dashboard");
  }

  if (error === "expired") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-950">
        <div className="w-full max-w-sm space-y-6 px-6 text-center">
          <div className="w-14 h-14 rounded-2xl bg-gray-900 border border-gray-800 flex items-center justify-center mx-auto">
            <LinkIcon size={24} className="text-gray-400" />
          </div>
          <div className="space-y-2">
            <h1 className="text-xl font-semibold text-white">Link expirado</h1>
            <p className="text-sm text-gray-400">
              Este link de redefinição não é mais válido. Links expiram em 1 hora por segurança.
            </p>
          </div>
          <Link
            href="/forgot-password"
            className="inline-block w-full py-2 px-4 bg-green-700 hover:bg-green-600 text-white text-sm font-medium rounded-md transition-colors"
          >
            Solicitar novo link
          </Link>
          <Link
            href="/login"
            className="block text-sm text-gray-400 hover:text-gray-300 transition-colors"
          >
            ← Voltar para o login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950">
      <div className="w-full max-w-sm space-y-6 px-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold text-white">Nova senha</h1>
          <p className="text-sm text-gray-400">Digite sua nova senha abaixo</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-3">
            <div className="space-y-1">
              <label htmlFor="password" className="block text-xs font-medium text-gray-400">
                Nova senha
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Mínimo 8 caracteres"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoFocus
                  autoComplete="new-password"
                  className="w-full px-3 py-2 pr-10 rounded-md bg-gray-900 border border-gray-800 text-white placeholder-gray-600 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 focus:ring-offset-gray-950"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-300 transition-colors p-1"
                  aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <div className="space-y-1">
              <label htmlFor="confirm-password" className="block text-xs font-medium text-gray-400">
                Confirmar senha
              </label>
              <div className="relative">
                <input
                  id="confirm-password"
                  type={showConfirm ? "text" : "password"}
                  placeholder="Repita a nova senha"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                  className="w-full px-3 py-2 pr-10 rounded-md bg-gray-900 border border-gray-800 text-white placeholder-gray-600 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 focus:ring-offset-gray-950"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-300 transition-colors p-1"
                  aria-label={showConfirm ? "Ocultar confirmação" : "Mostrar confirmação"}
                >
                  {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <button
            type="submit"
            disabled={loading || !sessionReady}
            className="w-full py-2 px-4 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-sm font-medium rounded-md transition-colors"
          >
            {loading ? "Salvando..." : "Redefinir senha"}
          </button>
        </form>
      </div>
    </div>
  );
}
