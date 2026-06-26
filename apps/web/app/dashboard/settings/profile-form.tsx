"use client";

import { useState } from "react";

interface Props {
  initialName: string;
  email: string;
  role: string;
}

export default function ProfileForm({ initialName, email, role }: Props) {
  const [name, setName] = useState(initialName);
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  async function handleSaveName(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || name.trim() === initialName) return;
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Erro ao salvar");
      setMsg({ type: "ok", text: "Nome atualizado." });
    } catch (err) {
      setMsg({ type: "err", text: err instanceof Error ? err.message : "Erro desconhecido" });
    } finally {
      setSaving(false);
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    if (newPw !== confirmPw) {
      setMsg({ type: "err", text: "Nova senha e confirmação não coincidem" });
      return;
    }
    if (newPw.length < 8) {
      setMsg({ type: "err", text: "Nova senha deve ter no mínimo 8 caracteres" });
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: newPw, currentPassword: currentPw }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Erro ao trocar senha");
      setMsg({ type: "ok", text: "Senha atualizada com sucesso." });
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");
    } catch (err) {
      setMsg({ type: "err", text: err instanceof Error ? err.message : "Erro desconhecido" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Profile card */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-4">
        <h2 className="text-sm font-medium text-gray-300">Perfil</h2>

        <div className="space-y-1 text-sm">
          <p className="text-gray-400">Email: <span className="text-white">{email}</span></p>
          <p className="text-gray-400">Função: <span className="text-white capitalize">{role}</span></p>
        </div>

        <form onSubmit={handleSaveName} className="flex items-end gap-3">
          <div className="flex-1">
            <label className="block text-xs text-gray-400 mb-1">Nome de exibição</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-green-500"
            />
          </div>
          <button
            type="submit"
            disabled={saving || !name.trim() || name.trim() === initialName}
            className="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white text-sm rounded-md transition-colors shrink-0"
          >
            Salvar
          </button>
        </form>
      </div>

      {/* Password card */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-4">
        <h2 className="text-sm font-medium text-gray-300">Alterar senha</h2>

        <form onSubmit={handleChangePassword} className="space-y-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Senha atual</label>
            <input
              type="password"
              value={currentPw}
              onChange={(e) => setCurrentPw(e.target.value)}
              required
              autoComplete="current-password"
              className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-green-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Nova senha</label>
            <input
              type="password"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
              className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-green-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Confirmar nova senha</label>
            <input
              type="password"
              value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
              className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-green-500"
            />
          </div>
          <button
            type="submit"
            disabled={saving || !currentPw || !newPw || !confirmPw}
            className="w-full py-2 bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white text-sm rounded-md transition-colors"
          >
            {saving ? "Salvando..." : "Alterar senha"}
          </button>
        </form>
      </div>

      {/* Feedback */}
      {msg && (
        <p
          className={`text-sm px-3 py-2 rounded-md border ${
            msg.type === "ok"
              ? "bg-green-900/30 border-green-800 text-green-400"
              : "bg-red-900/30 border-red-800 text-red-400"
          }`}
        >
          {msg.text}
        </p>
      )}
    </div>
  );
}
