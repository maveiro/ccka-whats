"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import CreateSessionForm from "@/components/create-session-form";
import Button from "@/components/ui/button";

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
        <Button variant={showForm ? "secondary" : "primary"} size="md" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancelar" : "Nova Sessão"}
        </Button>
      </div>
      {showForm && <CreateSessionForm onCreated={handleCreated} />}
    </div>
  );
}
