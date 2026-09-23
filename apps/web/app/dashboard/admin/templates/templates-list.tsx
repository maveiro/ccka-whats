"use client";

import { useState } from "react";
import { toast } from "sonner";
import TemplateForm from "./template-form";
import type { TemplateParaEditar } from "./template-form";
import EmptyState from "@/components/ui/empty-state";

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
  APPROVED: "text-green-400 border-green-800 light:text-green-700 light:border-green-300",
  PENDING: "text-yellow-400 border-yellow-800 light:text-yellow-700 light:border-yellow-300",
  REJECTED: "text-red-400 border-red-800 light:text-red-700 light:border-red-300",
  PAUSED: "text-orange-400 border-orange-800 light:text-orange-700 light:border-orange-300",
  DISABLED: "text-gray-400 border-gray-700 light:text-gray-600 light:border-gray-300",
  IN_APPEAL: "text-blue-400 border-blue-800 light:text-blue-700 light:border-blue-300",
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
      <p className="text-sm text-gray-400 light:text-gray-600">
        Cadastre um número em Campanhas antes de gerenciar templates.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1 bg-gray-800/50 rounded-md px-3 py-2 light:bg-gray-100">
        <label className="block text-xs text-gray-400 light:text-gray-600">Conta (WABA)</label>
        <select
          value={credentialId ?? ""}
          onChange={(e) => void carregar(e.target.value)}
          className="w-full px-3 py-2 rounded-md bg-gray-900 border border-gray-700 text-white text-sm light:bg-white light:border-gray-300 light:text-gray-900"
        >
          {credentials.map((c) => (
            <option key={c.id} value={c.id}>
              {c.artista ? `${c.artista} — ` : ""}{c.display_phone_number || c.phone_number_id}
            </option>
          ))}
        </select>
        <p className="text-[11px] text-gray-400 light:text-gray-600">
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
        <p className="text-sm font-medium text-white light:text-gray-900">Templates</p>
        <button onClick={() => void carregar()} className="text-xs text-gray-400 hover:text-white light:text-gray-600 light:hover:text-gray-900">
          {loading ? "Carregando..." : "Atualizar status"}
        </button>
      </div>

      {!carregouAlguma && !loading && (
        <p className="text-sm text-gray-400 light:text-gray-600">Clique em &quot;Atualizar status&quot; para carregar.</p>
      )}

      {carregouAlguma && templates.length === 0 && (
        <EmptyState title="Nenhum template nesta conta ainda." />
      )}

      <div className="space-y-2">
        {templates.map((t) => (
          <div key={t.id} className="bg-gray-900 border border-gray-800 rounded-lg p-3 space-y-1.5 light:bg-white light:border-gray-200">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm text-white font-mono light:text-gray-900">{t.name}</p>
              <span
                className={`text-xs px-2 py-0.5 rounded border shrink-0 ${
                  STATUS_COLOR[t.status] ?? "text-gray-400 border-gray-700 light:text-gray-600 light:border-gray-300"
                }`}
              >
                {STATUS_LABEL[t.status] ?? t.status}
              </span>
            </div>
            <p className="text-xs text-gray-400 light:text-gray-600">
              {t.language} · {normalizar(t.category)}
              {t.quality_score?.score ? ` · qualidade ${t.quality_score.score}` : ""}
            </p>
            <p className="text-xs text-gray-400 line-clamp-2 light:text-gray-600">{corpoDoTemplate(t.components)}</p>
            {t.status === "REJECTED" && t.rejected_reason && (
              <p className="text-xs text-red-400/90 bg-red-900/20 border border-red-900 rounded px-2 py-1">
                {t.rejected_reason}
              </p>
            )}
            {t.status === "REJECTED" && (
              <button
                onClick={() => setEditando({ id: t.id, name: t.name, language: t.language, category: t.category, components: t.components })}
                className="text-xs text-blue-400 hover:text-blue-300 light:text-blue-700 light:hover:text-blue-800"
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
