import { MessageSquare } from "lucide-react";

export default function DashboardPage() {
  return (
    <div className="hidden md:flex flex-1 flex-col items-center justify-center gap-4 text-center px-8">
      <div className="w-14 h-14 rounded-2xl bg-gray-900 border border-gray-800 flex items-center justify-center">
        <MessageSquare size={26} className="text-gray-400" />
      </div>
      <div>
        <p className="text-sm font-medium text-gray-400">Selecione uma conversa</p>
        <p className="text-xs text-gray-400 mt-1 max-w-xs">
          Escolha um chat à esquerda para visualizar as mensagens e responder
        </p>
      </div>
    </div>
  );
}
