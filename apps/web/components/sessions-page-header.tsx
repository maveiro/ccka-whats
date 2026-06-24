"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import CreateSessionForm from "@/components/create-session-form";

export default function SessionsPageHeader() {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);

  function handleCreated() {
    setShowForm(false);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-white">Sessões WhatsApp</h1>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="px-3 py-1.5 bg-green-700 hover:bg-green-600 text-white text-sm font-medium rounded-md transition-colors"
        >
          {showForm ? "Cancelar" : "Nova Sessão"}
        </button>
      </div>
      {showForm && <CreateSessionForm onCreated={handleCreated} />}
    </div>
  );
}
