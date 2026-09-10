import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // A página de formulário existe para ser embutida em sites de
        // terceiros. Sem liberar o embed explicitamente, o navegador recusa o
        // iframe — e o resto do painel deve continuar recusando, por isso o
        // cabeçalho é só para /f/.
        source: "/f/:slug",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors *" },
          // X-Frame-Options não tem equivalente a "qualquer origem" além de
          // ausente; declarar ALLOWALL é ignorado por navegadores modernos.
          // O CSP acima é o que vale.
        ],
      },
    ];
  },
};

export default nextConfig;
