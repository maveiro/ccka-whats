"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import Button from "@/components/ui/button";

interface Session {
  id: string;
  label: string | null;
  phone_number: string;
}

interface Props {
  operatorId: string;
  sessions: Session[];
  initialScope: "all" | "restricted";
  initialSessionIds: string[];
}

export default function OperatorSessionAccess({ operatorId, sessions, initialScope, initialSessionIds }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState(initialScope);
  const [selected, setSelected] = useState(new Set(initialSessionIds));
  const [saving, setSaving] = useState(false);

  const dirty = scope !== initialScope
    || selected.size !== initialSessionIds.length
    || initialSessionIds.some((id) => !selected.has(id));

  function toggleSession(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    const res = await fetch(`/api/operators/${operatorId}/session-access`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope, sessionIds: Array.from(selected) }),
    });
    setSaving(false);

    if (res.ok) {
      toast.success("Acesso a números atualizado");
      router.refresh();
    } else {
      const data = await res.json().catch(() => null) as { error?: string } | null;
      toast.error("Não foi possível salvar", { description: data?.error });
    }
  }

  return (
    <div className="border-t border-gray-800 mt-3 -mx-4 -mb-3 light:border-gray-200">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2 text-xs text-gray-400 hover:text-gray-300 hover:bg-gray-800/50 transition-colors light:text-gray-600 light:hover:text-gray-700"
        aria-expanded={open}
      >
        <span className="font-medium">
          Acesso a números {scope === "restricted" && `(${initialSessionIds.length} liberado${initialSessionIds.length === 1 ? "" : "s"})`}
        </span>
        <ChevronDown size={14} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setScope("all")}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                scope === "all" ? "border-green-700 text-green-400 bg-green-950/30 light:border-green-300 light:text-green-700 light:bg-green-50" : "border-gray-700 text-gray-400 hover:text-gray-300 light:border-gray-300 light:text-gray-600 light:hover:text-gray-700"
              }`}
            >
              Todos os números
            </button>
            <button
              onClick={() => setScope("restricted")}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                scope === "restricted" ? "border-green-700 text-green-400 bg-green-950/30 light:border-green-300 light:text-green-700 light:bg-green-50" : "border-gray-700 text-gray-400 hover:text-gray-300 light:border-gray-300 light:text-gray-600 light:hover:text-gray-700"
              }`}
            >
              Restrito a números específicos
            </button>
          </div>

          {scope === "restricted" && (
            <div className="space-y-1.5">
              {sessions.length === 0 && (
                <p className="text-xs text-gray-400 light:text-gray-600">Nenhuma sessão cadastrada ainda.</p>
              )}
              {sessions.map((s) => (
                <label key={s.id} className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer light:text-gray-700">
                  <input
                    type="checkbox"
                    checked={selected.has(s.id)}
                    onChange={() => toggleSession(s.id)}
                    className="rounded border-gray-700 bg-gray-800 text-green-600 focus:ring-green-500 focus:ring-offset-0 light:border-gray-300 light:bg-gray-100"
                  />
                  {s.label ?? s.phone_number}
                  <span className="text-gray-400 light:text-gray-600">{s.phone_number}</span>
                </label>
              ))}
            </div>
          )}

          <Button variant="primary" onClick={handleSave} disabled={!dirty || saving}>
            {saving ? "Salvando..." : "Salvar"}
          </Button>
        </div>
      )}
    </div>
  );
}
