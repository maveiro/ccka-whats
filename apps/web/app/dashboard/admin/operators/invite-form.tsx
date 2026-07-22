"use client";

import { useState } from "react";

interface Props {
  tenantId: string;
}

export default function InviteOperatorForm({ tenantId }: Props) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<"operator" | "admin">("operator");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState<"password" | "google" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleInvite() {
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch("/api/operators/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name, role, tenantId }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Erro ${res.status}`);
      }

      const data = await res.json() as { authMethod: "password" | "google" };
      setSuccess(data.authMethod);
      setEmail("");
      setName("");
      setRole("operator");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-5 space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-400 mb-1">Nome</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="João Silva"
            className="w-full px-3 py-2 rounded-md bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:ring-1 focus:ring-green-500"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">E-mail</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="joao@empresa.com"
            className="w-full px-3 py-2 rounded-md bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:ring-1 focus:ring-green-500"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs text-gray-400 mb-1">Papel</label>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as "operator" | "admin")}
          className="w-full px-3 py-2 rounded-md bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:ring-1 focus:ring-green-500"
        >
          <option value="operator">Operador — acesso às conversas</option>
          <option value="admin">Admin — acesso total</option>
        </select>
      </div>

      <button
        onClick={handleInvite}
        disabled={loading || !email}
        className="w-full py-2 px-4 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white text-sm font-medium rounded-md transition-colors"
      >
        {loading ? "Enviando convite..." : "Convidar"}
      </button>

      {success === "google" && (
        <div className="bg-green-900/30 border border-green-800 rounded-md p-3 text-sm text-green-300">
          Conta criada. Como o e-mail é de um domínio Google-only, a pessoa já pode
          entrar direto em &quot;Entrar com Google&quot; — sem senha, sem e-mail de convite.
        </div>
      )}
      {success === "password" && (
        <div className="bg-green-900/30 border border-green-800 rounded-md p-3 text-sm text-green-300">
          Convite enviado. O operador receberá um e-mail para definir a senha.
        </div>
      )}
      {error && (
        <div className="bg-red-900/30 border border-red-800 rounded-md p-3 text-sm text-red-300">
          {error}
        </div>
      )}
    </div>
  );
}
