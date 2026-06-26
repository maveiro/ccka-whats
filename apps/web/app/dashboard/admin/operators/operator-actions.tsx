"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Operator {
  id: string;
  name: string | null;
  email: string;
  role: string;
  active: boolean;
}

interface Props {
  operator: Operator;
  currentUserId: string;
}

export default function OperatorActions({ operator, currentUserId }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const isSelf = operator.id === currentUserId;

  async function patch(body: Record<string, unknown>) {
    setLoading(true);
    try {
      const res = await fetch(`/api/operators/${operator.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) router.refresh();
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`Remover ${operator.name ?? operator.email}? Esta ação não pode ser desfeita.`)) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/operators/${operator.id}`, { method: "DELETE" });
      if (res.ok) router.refresh();
    } finally {
      setLoading(false);
    }
  }

  if (isSelf) {
    return <span className="text-xs text-gray-600">(você)</span>;
  }

  return (
    <div className="flex items-center gap-2 shrink-0">
      <button
        onClick={() => patch({ role: operator.role === "admin" ? "operator" : "admin" })}
        disabled={loading}
        className="text-xs text-gray-400 hover:text-white transition-colors disabled:opacity-40"
        title={operator.role === "admin" ? "Rebaixar para operador" : "Promover a admin"}
      >
        {operator.role === "admin" ? "→ Operador" : "→ Admin"}
      </button>
      <span className="text-gray-700">·</span>
      <button
        onClick={() => patch({ active: !operator.active })}
        disabled={loading}
        className={`text-xs transition-colors disabled:opacity-40 ${
          operator.active ? "text-yellow-400 hover:text-yellow-300" : "text-green-400 hover:text-green-300"
        }`}
      >
        {operator.active ? "Desativar" : "Ativar"}
      </button>
      <span className="text-gray-700">·</span>
      <button
        onClick={handleDelete}
        disabled={loading}
        className="text-xs text-red-400 hover:text-red-300 transition-colors disabled:opacity-40"
      >
        Excluir
      </button>
    </div>
  );
}
