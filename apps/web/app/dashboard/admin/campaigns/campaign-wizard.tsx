"use client";

import { useId, useState } from "react";
import Papa from "papaparse";
import Button from "@/components/ui/button";

interface Credential {
  id: string;
  waba_id: string;
  phone_number_id: string;
  display_phone_number: string | null;
  artista: string | null;
  active: boolean;
}

interface TemplateButton {
  type?: string;
  text?: string;
  url?: string;
  flow_id?: string;
}

// Flow abrível numa conversa, do mesmo número da campanha.
interface Flow {
  id: string;
  cloud_credential_id: string;
  nome: string;
  artista: string | null;
  tipo: string;
  ativo: boolean;
  meta_flow_id: string | null;
}

interface Template {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  // `format` só existe no HEADER (TEXT | IMAGE | VIDEO | DOCUMENT) e decide
  // se o cabeçalho pede uma variável de texto ou uma mídia.
  components: { type: string; format?: string; text?: string; buttons?: TemplateButton[] }[];
}

interface ParsedRecipient {
  phone: string;
  variables: Record<string, string>;
}

type Step = "credential" | "template" | "csv" | "review" | "done";

// Botão de URL com placeholder na ponta = link rastreado (migration campanhas_clique_rastreado): o
// campaign-sender manda o click_token de cada destinatário como sufixo.
// Importa para a UI porque essa variável é a única que NÃO vem do CSV.
function dynamicUrlButton(components: Template["components"]): TemplateButton | null {
  for (const component of components) {
    const found = component.buttons?.find(
      (b) => b.type?.toUpperCase() === "URL" && typeof b.url === "string" && b.url.includes("{{"),
    );
    if (found) return found;
  }
  return null;
}

// Botão de Flow = a campanha abre a central. Precisa dizer QUAL central: é
// de lá que sai a sessão que identifica cada pessoa dentro do Flow, e enviar
// sem isso não dá erro — só faz a base inteira abrir como desconhecida.
function flowButton(components: Template["components"]): TemplateButton | null {
  for (const component of components) {
    const found = component.buttons?.find((b) => b.type?.toUpperCase() === "FLOW");
    if (found) return found;
  }
  return null;
}

/**
 * Quantas colunas de variável o CSV precisa ter — CABEÇALHO + CORPO.
 *
 * Contava só o corpo até 18/09/2026, e por isso um template com a variável no
 * cabeçalho ("Olá, {{1}}") aparecia aqui como "0 variáveis": a pessoa subia o
 * CSV com o nome assim mesmo, e a Meta recusava 100% dos envios com
 * "(#132000) Number of parameters does not match". Os dois trechos numeram
 * seus placeholders de forma independente (ambos começam em {{1}}), então o
 * que vale é a SOMA, e a ordem é cabeçalho primeiro.
 *
 * Espelha `planoDeVariaveis` em supabase/functions/campaign-sender/variaveis.ts
 * — Edge Function (Deno) e painel (Next) não compartilham módulo.
 */
function contarVariaveis(components: Template["components"]): { header: number; body: number; total: number } {
  const conta = (texto?: string) => {
    const achados = texto?.match(/\{\{\s*\d+\s*\}\}/g);
    return achados ? new Set(achados.map((m) => m.replace(/\s/g, ""))).size : 0;
  };
  const cabecalho = components.find((c) => c.type === "HEADER");
  const header = (cabecalho?.format ?? "TEXT").toUpperCase() === "TEXT" ? conta(cabecalho?.text) : 0;
  const body = conta(components.find((c) => c.type === "BODY")?.text);
  return { header, body, total: header + body };
}

/** Cabeçalho de mídia exige um parâmetro de imagem/vídeo que ainda não montamos. */
function headerDeMidia(components: Template["components"]): string | null {
  const cabecalho = components.find((c) => c.type === "HEADER");
  const formato = cabecalho?.format?.toUpperCase();
  return formato && formato !== "TEXT" ? formato : null;
}

function countPlaceholders(components: Template["components"]): number {
  return contarVariaveis(components).total;
}

export default function CampaignWizard({ credentials: iniciais }: { credentials: Credential[] }) {
  // Em estado, e não só na prop: número recém-cadastrado precisa aparecer no
  // seletor sem recarregar a página (a prop vem do Server Component).
  const [credentials, setCredentials] = useState(iniciais);
  const hasCredential = credentials.length > 0;
  const [step, setStep] = useState<Step>(hasCredential ? "template" : "credential");
  const [error, setError] = useState<string | null>(null);

  // Credencial
  const [wabaId, setWabaId] = useState("");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [displayPhoneNumber, setDisplayPhoneNumber] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [savingCredential, setSavingCredential] = useState(false);

  // Templates
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  // O número que DISPARA. Antes o assistente usava sempre `credentials[0]` e
  // "Trocar número" abria o cadastro de uma credencial nova — com quatro
  // números cadastrados, não havia como escolher de qual sair (achado pelo
  // fundador em 18/09/2026). A rota de templates já aceitava `credentialId`
  // desde a multi-número; faltava a tela.
  const [credentialId, setCredentialId] = useState<string | null>(iniciais[0]?.id ?? null);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);

  // Campanha
  const [name, setName] = useState("");
  const [clickTargetUrl, setClickTargetUrl] = useState("");
  const [flows, setFlows] = useState<Flow[]>([]);
  const [flowId, setFlowId] = useState("");

  // CSV
  const [recipients, setRecipients] = useState<ParsedRecipient[]>([]);
  const [csvError, setCsvError] = useState<string | null>(null);

  // Disparo
  const [creating, setCreating] = useState(false);
  const [result, setResult] = useState<{ campaignId: string; accepted: number; skippedOptOut: number; skippedInvalid: number; skippedDuplicate: number } | null>(null);

  async function loadTemplates(deQual: string | null = credentialId) {
    setLoadingTemplates(true);
    setError(null);
    try {
      const res = await fetch(`/api/campaigns/templates${deQual ? `?credentialId=${deQual}` : ""}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Erro ${res.status}`);
      }
      const data = await res.json() as { credentialId: string; templates: Template[] };
      setTemplates(data.templates);
      // A rota devolve a credencial que usou: com `?credentialId=` é a nossa,
      // sem ele é a mais antiga do tenant. Guardar o que ela respondeu evita
      // divergência entre o que a tela mostra e o que vai disparar.
      setCredentialId(data.credentialId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingTemplates(false);
    }
  }

  async function handleSaveCredential() {
    setSavingCredential(true);
    setError(null);
    try {
      const res = await fetch("/api/campaigns/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wabaId, phoneNumberId, displayPhoneNumber, accessToken }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Erro ${res.status}`);
      }

      // O número recém-cadastrado entra no seletor e vira o escolhido — quem
      // acabou de cadastrar quer disparar DELE. Sem isso, o assistente
      // continuaria no número anterior e o cadastro pareceria não ter efeito.
      const nova = await res.json() as Credential;
      setCredentials((cs) => [...cs.filter((c) => c.id !== nova.id), nova]);
      setCredentialId(nova.id);
      setSelectedTemplate(null);
      setTemplates([]);
      setStep("template");
      await loadTemplates(nova.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingCredential(false);
    }
  }

  async function loadFlows() {
    try {
      const res = await fetch("/api/flows");
      if (!res.ok) return;
      setFlows(await res.json() as Flow[]);
    } catch {
      // Lista vazia já bloqueia o disparo com mensagem própria abaixo.
    }
  }

  function handleSelectTemplate(t: Template) {
    setSelectedTemplate(t);
    setName(`${t.name} — ${new Date().toLocaleDateString("pt-BR")}`);
    if (flowButton(t.components)) void loadFlows();
    setStep("csv");
  }

  function handleCsvFile(file: File) {
    setCsvError(null);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const rows = result.data;
        const fields = result.meta.fields ?? [];
        const phoneField = fields.find((f) => f.trim().toLowerCase() === "phone");
        if (!phoneField) {
          setCsvError("CSV precisa de uma coluna 'phone' (telefone em E.164, sem '+', ex: 5541999999999).");
          return;
        }
        const varFields = fields.filter((f) => f !== phoneField);
        const parsed: ParsedRecipient[] = rows
          .map((row) => {
            const phone = (row[phoneField] ?? "").replace(/\D/g, "");
            const variables: Record<string, string> = {};
            varFields.forEach((f, idx) => {
              const value = row[f];
              if (value != null && value !== "") variables[String(idx + 1)] = value;
            });
            return { phone, variables };
          })
          .filter((r) => /^\d{10,15}$/.test(r.phone));

        if (parsed.length === 0) {
          setCsvError("Nenhuma linha com telefone válido encontrada.");
          return;
        }
        setRecipients(parsed);
        setStep("review");
      },
      error: (err) => setCsvError(err.message),
    });
  }

  async function handleCreate() {
    if (!selectedTemplate || !credentialId) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          credentialId,
          templateName: selectedTemplate.name,
          templateLanguage: selectedTemplate.language,
          templateCategory: selectedTemplate.category,
          templateComponents: selectedTemplate.components,
          clickTargetUrl,
          flowId: flowId || undefined,
          recipients,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Erro ${res.status}`);
      }
      const data = await res.json();
      setResult(data);
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  function reset() {
    setStep("template");
    setSelectedTemplate(null);
    setRecipients([]);
    setResult(null);
    setError(null);
    setCsvError(null);
    setName("");
    setClickTargetUrl("");
    setFlowId("");
  }

  const trackedButton = selectedTemplate ? dynamicUrlButton(selectedTemplate.components) : null;
  const missingTargetUrl = trackedButton !== null && !clickTargetUrl.trim();

  const templateFlowButton = selectedTemplate ? flowButton(selectedTemplate.components) : null;
  // Só Flow publicado na Meta, ativo e DO MESMO número — abrir a central de
  // outro artista entregaria a agenda errada para a base inteira, e a Graph
  // API aceitaria sem reclamar.
  const flowsDisponiveis = flows.filter(
    (f) =>
      f.cloud_credential_id === credentialId &&
      f.ativo &&
      f.meta_flow_id &&
      ["central", "agenda_shows"].includes(f.tipo) &&
      // O botão do template já carrega o Flow da Meta congelado: quando ele
      // diz qual é, não há escolha a fazer — só conferir.
      (!templateFlowButton?.flow_id || f.meta_flow_id === templateFlowButton.flow_id),
  );
  const missingFlow = templateFlowButton !== null && !flowId;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-5 space-y-4 light:bg-white light:border-gray-200">
      {error && <p className="text-xs text-red-400 bg-red-900/20 border border-red-900 rounded-md px-3 py-2">{error}</p>}

      {step === "credential" && (
        <div className="space-y-3">
          <p className="text-sm font-medium text-white light:text-gray-900">
            {hasCredential ? "Cadastrar outro número do WhatsApp Cloud API" : "Conectar WhatsApp Cloud API"}
          </p>
          <p className="text-xs text-gray-400 light:text-gray-600">
            Dados do WhatsApp Business Account (WABA) no Meta Business Manager. O token de
            acesso nunca é reexibido depois de salvo.
            {hasCredential && " Cadastrar aqui NÃO mexe nos outros números do tenant — para administrá-los, use Números."}
          </p>
          <Field label="WABA ID" value={wabaId} onChange={setWabaId} />
          <Field label="Phone Number ID" value={phoneNumberId} onChange={setPhoneNumberId} />
          <Field label="Número exibido (opcional)" value={displayPhoneNumber} onChange={setDisplayPhoneNumber} />
          <Field label="Access Token (permanente)" value={accessToken} onChange={setAccessToken} type="password" />
          <div className="flex gap-2">
            <Button
              variant="primary"
              size="md"
              onClick={handleSaveCredential}
              disabled={savingCredential || !wabaId || !phoneNumberId || !accessToken}
              className="flex-1 justify-center"
            >
              {savingCredential ? "Salvando..." : "Salvar e continuar"}
            </Button>
            {hasCredential && (
              <Button variant="secondary" size="md" onClick={() => { setStep("template"); setError(null); }}>
                Cancelar
              </Button>
            )}
          </div>
        </div>
      )}

      {step === "template" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-white light:text-gray-900">Escolher modelo (template aprovado)</p>
            <button onClick={() => void loadTemplates()} className="text-xs text-gray-400 hover:text-white light:text-gray-600 light:hover:text-gray-900">
              {loadingTemplates ? "Carregando..." : "Recarregar"}
            </button>
          </div>
          {hasCredential && (
            <div className="space-y-1 bg-gray-800/50 rounded-md px-3 py-2 light:bg-gray-100">
              <label className="block text-xs text-gray-400 light:text-gray-600">Disparar a partir de</label>
              <select
                value={credentialId ?? ""}
                onChange={(e) => {
                  setCredentialId(e.target.value);
                  // Trocar o número invalida a escolha anterior: o template é
                  // aprovado na conta (WABA), mas quem envia é o número — e
                  // seguir com um template selecionado dá a impressão de que
                  // nada mudou.
                  setSelectedTemplate(null);
                  setTemplates([]);
                  void loadTemplates(e.target.value);
                }}
                className="w-full px-3 py-2 rounded-md bg-gray-900 border border-gray-700 text-white text-sm light:bg-white light:border-gray-300 light:text-gray-900"
              >
                {credentials.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.artista ? `${c.artista} — ` : ""}{c.display_phone_number || c.phone_number_id}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-gray-400 light:text-gray-600">
                É este número que aparece para quem recebe, e é o limite e a nota de
                qualidade dele que valem no disparo. Os modelos vêm da conta (WABA), então
                números da mesma conta oferecem a mesma lista.{" "}
                <button
                  onClick={() => { setStep("credential"); setError(null); }}
                  className="text-green-400 hover:text-green-300 light:text-green-700"
                >
                  cadastrar outro número
                </button>
              </p>
            </div>
          )}
          {templates.length === 0 && !loadingTemplates && (
            <button onClick={() => void loadTemplates()} className="text-xs text-green-400 hover:text-green-300 light:text-green-700">
              Buscar templates aprovados na Meta
            </button>
          )}
          <div className="space-y-2">
            {templates.map((t) => (
              <button
                key={t.id}
                onClick={() => handleSelectTemplate(t)}
                className="w-full text-left bg-gray-800 hover:bg-gray-750 border border-gray-700 rounded-md px-3 py-2 transition-colors light:bg-gray-100 light:border-gray-300"
              >
                <p className="text-sm text-white light:text-gray-900">{t.name}</p>
                <p className="text-xs text-gray-400 light:text-gray-600">
                  {t.language} · {t.category} · {countPlaceholders(t.components)} variável(is)
                  {contarVariaveis(t.components).header > 0 ? " (1 no cabeçalho)" : ""}
                  {headerDeMidia(t.components) ? ` · cabeçalho de ${headerDeMidia(t.components)}` : ""}
                </p>
              </button>
            ))}
          </div>
        </div>
      )}

      {step === "csv" && selectedTemplate && (
        <div className="space-y-3">
          <p className="text-sm font-medium text-white light:text-gray-900">Base de contatos — {selectedTemplate.name}</p>
          <p className="text-xs text-gray-400 light:text-gray-600">
            CSV com coluna <code className="font-mono">phone</code> (E.164 sem &quot;+&quot;) e, se o
            template tiver variáveis, colunas adicionais na ordem dos placeholders {"{{1}}"}, {"{{2}}"}...
            (template tem {countPlaceholders(selectedTemplate.components)} variável(is)).
          </p>
          {contarVariaveis(selectedTemplate.components).header > 0 && (
            <p className="text-xs text-blue-300 bg-blue-900/20 border border-blue-900 rounded-md px-3 py-2">
              Este template tem variável no <b>cabeçalho</b>. Cabeçalho e corpo numeram os
              placeholders separadamente (os dois começam em {"{{1}}"}), então as colunas vão
              nesta ordem: <b>primeiro a do cabeçalho</b>
              {contarVariaveis(selectedTemplate.components).body > 0
                ? `, depois as ${contarVariaveis(selectedTemplate.components).body} do corpo.`
                : " (o corpo não tem nenhuma)."}
            </p>
          )}
          {headerDeMidia(selectedTemplate.components) && (
            <p className="text-xs text-red-300 bg-red-900/20 border border-red-900 rounded-md px-3 py-2">
              Este template tem cabeçalho de <b>{headerDeMidia(selectedTemplate.components)}</b>, que
              ainda não sabemos preencher — todos os envios seriam recusados pela Meta. Escolha um
              template de cabeçalho em texto.
            </p>
          )}
          {trackedButton && (
            <p className="text-xs text-amber-400 bg-amber-900/20 border border-amber-900 rounded-md px-3 py-2">
              O botão <b>{trackedButton.text}</b> tem link rastreado. A variável dele{" "}
              <b>não é coluna do CSV</b> — o link único de cada pessoa é gerado por nós.
              Conte só as {countPlaceholders(selectedTemplate.components)} variável(is) do texto.
            </p>
          )}
          <input
            type="file"
            accept=".csv"
            onChange={(e) => e.target.files?.[0] && handleCsvFile(e.target.files[0])}
            className="text-sm text-gray-300 light:text-gray-700"
          />
          {csvError && <p className="text-xs text-red-400">{csvError}</p>}
          <button onClick={() => setStep("template")} className="text-xs text-gray-400 hover:text-white light:text-gray-600 light:hover:text-gray-900">
            ← Voltar
          </button>
        </div>
      )}

      {step === "review" && selectedTemplate && (
        <div className="space-y-3">
          <p className="text-sm font-medium text-white light:text-gray-900">Revisão</p>
          <Field label="Nome da campanha" value={name} onChange={setName} />
          {trackedButton && (
            <div className="space-y-1">
              <Field
                label={`Destino do botão "${trackedButton.text}"`}
                value={clickTargetUrl}
                onChange={setClickTargetUrl}
              />
              <p className="text-xs text-gray-400 light:text-gray-600">
                Para onde a pessoa vai depois do clique (ex: a página do evento no Sympla).
                O link do template passa pelo nosso redirect, que registra quem clicou.
              </p>
            </div>
          )}
          {templateFlowButton && (
            <div className="space-y-1">
              <label className="block text-xs text-gray-400 mb-1 light:text-gray-600">
                Central aberta pelo botão &quot;{templateFlowButton.text}&quot;
              </label>
              <select
                value={flowId}
                onChange={(e) => setFlowId(e.target.value)}
                className="w-full px-3 py-2 rounded-md bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:ring-1 focus:ring-green-500 light:bg-gray-100 light:border-gray-300 light:text-gray-900"
              >
                <option value="">Escolher...</option>
                {flowsDisponiveis.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.artista ? `${f.artista} — ${f.nome}` : f.nome}
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-400 light:text-gray-600">
                Cada destinatário recebe um token próprio, então quem já é cadastrado abre a
                central direto no menu, sem se cadastrar de novo.
              </p>
              {flowsDisponiveis.length === 0 && (
                <p className="text-xs text-amber-400">
                  Nenhum Flow publicado na Meta para este número corresponde ao botão deste
                  template. Publique a central em Flows antes de disparar.
                </p>
              )}
            </div>
          )}
          <p className="text-xs text-gray-400 light:text-gray-600">
            {recipients.length} destinatário(s) válido(s) · template <b>{selectedTemplate.name}</b> ({selectedTemplate.category})
          </p>
          <div className="max-h-40 overflow-y-auto border border-gray-800 rounded-md light:border-gray-200">
            <table className="w-full text-xs">
              <thead className="bg-gray-800 text-gray-400 light:bg-gray-100 light:text-gray-600">
                <tr>
                  <th className="text-left px-2 py-1">Telefone</th>
                  <th className="text-left px-2 py-1">Variáveis</th>
                </tr>
              </thead>
              <tbody>
                {recipients.slice(0, 10).map((r, i) => (
                  <tr key={i} className="border-t border-gray-800 text-gray-300 light:border-gray-200 light:text-gray-700">
                    <td className="px-2 py-1">{r.phone}</td>
                    <td className="px-2 py-1">{Object.values(r.variables).join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {recipients.length > 10 && (
              <p className="text-xs text-gray-400 px-2 py-1 light:text-gray-600">+{recipients.length - 10} destinatário(s)</p>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              variant="primary"
              size="md"
              onClick={handleCreate}
              disabled={creating || !name.trim() || missingTargetUrl || missingFlow}
              className="flex-1 justify-center"
            >
              {creating ? "Criando..." : "Criar campanha"}
            </Button>
            <Button variant="secondary" size="md" onClick={() => setStep("csv")}>
              ← Voltar
            </Button>
          </div>
        </div>
      )}

      {step === "done" && result && (
        <div className="space-y-3">
          <p className="text-sm font-medium text-green-400 light:text-green-700">Campanha criada</p>
          <p className="text-xs text-gray-400 light:text-gray-600">
            {result.accepted} destinatário(s) aceitos
            {result.skippedOptOut > 0 && `, ${result.skippedOptOut} removido(s) por opt-out`}
            {result.skippedInvalid > 0 && `, ${result.skippedInvalid} inválido(s)`}
            {result.skippedDuplicate > 0 && `, ${result.skippedDuplicate} duplicado(s) (telefone repetido no CSV)`}.
            Dispare na lista abaixo quando estiver pronta.
          </p>
          <button onClick={reset} className="text-xs text-green-400 hover:text-green-300 light:text-green-700">
            + Nova campanha
          </button>
        </div>
      )}
    </div>
  );
}

function Field({
  label, value, onChange, type = "text",
}: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="block text-xs text-gray-400 mb-1 light:text-gray-600">{label}</label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded-md bg-gray-800 border border-gray-700 text-white text-sm focus:outline-none focus:ring-1 focus:ring-green-500 light:bg-gray-100 light:border-gray-300 light:text-gray-900"
      />
    </div>
  );
}
