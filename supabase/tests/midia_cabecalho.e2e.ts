// Validação da mídia de cabeçalho de campanha (apps/web/lib/whatsapp-cloud/midiaCabecalho.ts).
// Puro, sem banco nem rede. COMO RODAR: `npm run test:db`.

import { conferirMidia, hostInterno, validarUrlMidia } from "../../apps/web/lib/whatsapp-cloud/midiaCabecalho.ts";

let falhas = 0;
let passou = 0;
function checar(c: boolean, m: string): void {
  if (c) passou++; else { falhas++; console.error(`  ✗ ${m}`); }
}

for (const h of ["localhost", "127.0.0.1", "10.0.0.5", "172.16.3.1", "192.168.1.1", "169.254.169.254", "metadata", "[::1]", "foo.internal"]) {
  checar(hostInterno(h), `${h} deveria ser interno`);
}
for (const h of ["cdn.exemplo.com", "8.8.8.8", "172.32.0.1", "xyz.supabase.co"]) {
  checar(!hostInterno(h), `${h} deveria ser público`);
}

checar(validarUrlMidia("https://cdn.exemplo.com/a.png") === null, "https público passa");
checar(validarUrlMidia("http://cdn.exemplo.com/a.png") !== null, "http recusado");
checar(validarUrlMidia("https://127.0.0.1/a.png") !== null, "IP interno recusado");
checar(validarUrlMidia("https://u:p@cdn.exemplo.com/a.png") !== null, "credencial na URL recusada");
checar(validarUrlMidia("") !== null && validarUrlMidia(undefined) !== null && validarUrlMidia("nao-e-url") !== null, "vazio/inválido recusado");

checar(conferirMidia("IMAGE", "image/png", 1000) === null, "png ok");
checar(conferirMidia("IMAGE", "image/jpeg; charset=x", null) === null, "jpeg sem length ok");
checar(conferirMidia("IMAGE", "image/webp", 1000) !== null, "webp recusado");
checar(conferirMidia("IMAGE", "image/png", 6 * 1024 * 1024) !== null, "imagem >5MB recusada");
checar(conferirMidia("VIDEO", "video/mp4", 10 * 1024 * 1024) === null, "mp4 10MB ok");
checar(conferirMidia("VIDEO", "video/mp4", 17 * 1024 * 1024) !== null, "vídeo >16MB recusado");
checar(conferirMidia("DOCUMENT", "application/pdf", 50 * 1024 * 1024) === null, "pdf 50MB ok");
checar(conferirMidia("DOCUMENT", "text/html", 10) !== null, "html recusado como documento");
checar(conferirMidia("IMAGE", null, 10) !== null, "sem content-type recusado");

console.log(`\n${passou} asserções passaram, ${falhas} falharam`);
if (falhas > 0) Deno.exit(1);
