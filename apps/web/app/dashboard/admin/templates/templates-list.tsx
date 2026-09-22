"use client";

import { useState } from "react";
import { toast } from "sonner";
import TemplateForm from "./template-form";
import type { TemplateParaEditar } from "./template-form";

interface Credential {
  id: string;
  waba_id: string;
  phone_number_id: string;
  display_phone_number: string | null;
  artista: string | null;
  active: boolean;
}

interface Template {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  components: unknown[];
  rejected_reason?: string;
  quality_score?: { score?: string } | null;
}

const STATUS_LABEL: Record<string, string> = {
  APPROVED: "Aprovado",
  PENDING: "Em revisão",
  REJECTED: "Rejeitado",
  PAUSED: "Pausado",
  DISABLED: "Desativado",
  IN_APPEAL: "Em recurso",
};

const STATUS_COLOR: Record<string, string> = {
  APPROVED: "text-green-400 border-green-800",
  PENDING: "text-yellow-400 border-yellow-800",
  REJECTED: "text-red-400 border-red-800",
  PAUSED: "text-orange-400 border-orange-800",
  DISABLED: "text-gray-500 border-gray-700",
  IN_APPEAL: "text-blue-400 border-blue-800",
};

// A Meta chama de "utility"/"marketing" na criação e devolve
// "MARKETING"/"UTILITY" na leitura — sem padrão único de caixa entre as
// duas pontas da própria API deles. Normaliza para maiúsculo antes de
// comparar/mostrar, para não duplicar entradas por causa disso.
function normalizar(valor: string): string {
  return valor.toUpperCase();
}

function corpoDoTemplate(components: Template["components"]): string {
  const body = (components as { type?: string; text?: string }[])
    .find((c) => c.type?.toUpperCase() === "BODY");
  return body?.text ?? "(sem corpo)";
}

export default function TemplatesList({
  credentials: iniciais,
  linkBaseUrl,
}: {
  credentials: Credential[];
  linkBaseUrl: string | null;
}) {
  const [credentials] = useState(iniciais);
  const hasCredential = credentials.length > 0;
  const [credentialId, setCredentialId] = useState<string | null>(iniciais[0]?.id ?? null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(false);
  const [carregouAlguma, setCarregouAlguma] = useState(false);
  const [editando, setEditando] = useState<TemplateParaEditar | null>(null);

  async function carregar(deQual: string | null = credentialId) {
    setLoading(true);
    try {
      const res = await fetch(`/api/templates${deQual ? `?credentialId=${deQual}` : ""}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Erro ${res.status}`);
      setTemplates(data.templates ?? []);
      setCredentialId(data.credentialId);
      setCarregouAlguma(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  if (!hasCredential) {
    return (
      <p className="text-sm text-gray-500">
        Cadastre um número em Campanhas antes de gerenciar templates.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1 bg-gray-800/50 rounded-md px-3 py-2">
        <label className="block text-xs text-gray-400">Conta (WABA)</label>
        <select
          value={credentialId ?? ""}
          onChange={(e) => void carregar(e.target.value)}
          className="w-full px-3 py-2 rounded-md bg-gray-900 border border-gray-700 text-white text-sm"
        >
          {credentials.map((c) => (
            <option key={c.id} value={c.id}>
              {c.artista ? `${c.artista} — ` : ""}{c.display_phone_number || c.phone_number_id}
            </option>
          ))}
        </select>
        <p className="text-[11px] text-gray-500">
          Template é aprovado na CONTA, não no número — números da mesma WABA
          compartilham a mesma lista.
        </p>
      </div>

      {/* `key` força um componente NOVO a cada template diferente sendo
          editado — o formulário deriva seu estado inicial das props no
          próprio useState (sem useEffect), então precisa remontar quando o
          alvo da edição muda, não só re-renderizar. */}
      <TemplateForm
        key={editando?.id ?? "novo"}
        credentials={credentials}
        credentialId={credentialId}
        onCredentialChange={(id) => setCredentialId(id)}
        linkBaseUrl={linkBaseUrl}
        onCriado={() => void carregar()}
        templateParaEditar={editando}
        onEditado={() => { setEditando(null); void carregar(); }}
        onFecharEdicao={() => setEditando(null)}
      />

      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-white">Templates</p>
        <button onClick={() => void carregar()} className="text-xs text-gray-400 hover:text-white">
          {loading ? "Carregando..." : "Atualizar status"}
        </button>
      </div>

      {!carregouAlguma && !loading && (
        <p className="text-sm text-gray-500">Clique em &quot;Atualizar status&quot; para carregar.</p>
      )}

      {carregouAlguma && templates.length === 0 && (
        <p className="text-sm text-gray-500">Nenhum template nesta conta ainda.</p>
      )}

      <div className="space-y-2">
        {templates.map((t) => (
          <div key={t.id} className="bg-gray-900 border border-gray-800 rounded-lg p-3 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm text-white font-mono">{t.name}</p>
              <span
                className={`text-xs px-2 py-0.5 rounded border shrink-0 ${
                  STATUS_COLOR[t.status] ?? "text-gray-400 border-gray-700"
                }`}
              >
                {STATUS_LABEL[t.status] ?? t.status}
              </span>
            </div>
            <p className="text-xs text-gray-500">
              {t.language} · {normalizar(t.category)}
              {t.quality_score?.score ? ` · qualidade ${t.quality_score.score}` : ""}
            </p>
            <p className="text-xs text-gray-400 line-clamp-2">{corpoDoTemplate(t.components)}</p>
            {t.status === "REJECTED" && t.rejected_reason && (
              <p className="text-xs text-red-400/90 bg-red-900/20 border border-red-900 rounded px-2 py-1">
                {t.rejected_reason}
              </p>
            )}
            {t.status === "REJECTED" && (
              <button
                onClick={() => setEditando({ id: t.id, name: t.name, language: t.language, category: t.category, components: t.components })}
                className="text-xs text-blue-400 hover:text-blue-300"
              >
                Editar e reenviar
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
