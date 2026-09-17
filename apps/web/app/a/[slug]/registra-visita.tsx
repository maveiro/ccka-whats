"use client";

import { useEffect } from "react";

// Beacon de visualização. Existe como componente de cliente porque a página é
// cacheada por 60s — contar no servidor contaria uma vez por minuto, não uma
// por pessoa.
//
// Uma vez por aba (sessionStorage): recarregar a página não é uma visita
// nova. Não é identificação de visitante — o valor não sai do navegador e não
// é enviado para nós; serve só para não contar duas vezes o mesmo F5.
export default function RegistraVisita({ slug }: { slug: string }) {
  useEffect(() => {
    const chave = `visita:${slug}`;
    try {
      if (sessionStorage.getItem(chave)) return;
      sessionStorage.setItem(chave, "1");
    } catch {
      // Navegador com armazenamento bloqueado: conta a visita e segue. Melhor
      // contar duas vezes do que não contar.
    }

    // `keepalive` para o request sobreviver a quem toca num botão logo ao
    // abrir — que é o comportamento comum vindo de story.
    fetch("/api/paginas/visita", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug }),
      keepalive: true,
    }).catch(() => {});
  }, [slug]);

  return null;
}
