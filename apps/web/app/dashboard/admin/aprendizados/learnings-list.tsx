"use client";

import { useState } from "react";

interface Learning {
  id: string;
  title: string;
  description: string;
  category: string;
  created_at: string;
}

const CATEGORY_COLOR: Record<string, string> = {
  bug: "text-red-400 border-red-800",
  decisao: "text-blue-400 border-blue-800",
  comportamento_externo: "text-orange-400 border-orange-800",
  geral: "text-gray-400 border-gray-700",
};

export default function LearningsList({ initial }: { initial: Learning[] }) {
  const [learnings, setLearnings] = useState(initial);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("geral");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/learnings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, description, category }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Erro ${res.status}`);
      }
      const created = await res.json() as Learning;
      setLearnings((prev) => [created, ...prev]);
      setAdding(false);
      setTitle("");
      setDescription("");
      setCategory("geral");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (deleteConfirm !== id) { setDeleteConfirm(id); return; }
    await fetch(`/api/learnings/${id}`, { method: "DELETE" });
    setLearnings((prev) => prev.filter((l) => l.id !== id));
    setDeleteConfirm(null);
  }

  return (
    <div className="space-y-4">
      {adding ? (
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-5 space-y-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Título</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex: service_role_key com aspas quebra o pg_cron"
              className="w-full px-3 py-2 rounded-md bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:ring-1 focus:ring-green-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Categoria</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full px-3 py-2 rounded-md bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:ring-1 focus:ring-green-500"
            >
              <option value="geral">Geral</option>
              <option value="bug">Bug</option>
              <option value="decisao">Decisão</option>
              <option value="comportamento_externo">Comportamento externo (Meta/API)</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Descrição</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              className="w-full px-3 py-2 rounded-md bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:ring-1 focus:ring-green-500"
            />
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving || !title.trim() || !description.trim()}
              className="flex-1 py-2 px-4 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white text-sm font-medium rounded-md transition-colors"
            >
              {saving ? "Salvando..." : "Salvar"}
            </button>
            <button
              onClick={() => { setAdding(false); setError(null); }}
              className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white text-sm rounded-md transition-colors"
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="w-full py-2 px-4 border border-dashed border-gray-700 text-gray-400 hover:border-green-600 hover:text-green-400 text-sm rounded-md transition-colors"
        >
          + Registrar aprendizado
        </button>
      )}

      {learnings.length === 0 && !adding && (
        <p className="text-sm text-gray-500">Nenhum aprendizado registrado ainda.</p>
      )}

      <div className="space-y-3">
        {learnings.map((l) => (
          <div key={l.id} className="bg-gray-900 border border-gray-800 rounded-lg px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-white">{l.title}</p>
                <p className="text-xs text-gray-400 mt-1 whitespace-pre-wrap">{l.description}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={`text-xs px-2 py-0.5 rounded border ${CATEGORY_COLOR[l.category] ?? CATEGORY_COLOR.geral}`}>
                  {l.category}
                </span>
                <button
                  onClick={() => handleDelete(l.id)}
                  className={`text-xs px-2 py-1 rounded transition-colors ${
                    deleteConfirm === l.id ? "bg-red-700 text-white" : "text-red-500 hover:text-red-400"
                  }`}
                >
                  {deleteConfirm === l.id ? "Confirmar?" : "Excluir"}
                </button>
              </div>
            </div>
            <p className="text-xs text-gray-600 mt-2">
              {new Date(l.created_at).toLocaleString("pt-BR")}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
