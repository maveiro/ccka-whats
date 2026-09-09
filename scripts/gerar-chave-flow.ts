// Gera o par RSA do endpoint de WhatsApp Flows (Sprint B1).
//
//   deno run -A scripts/gerar-chave-flow.ts <phone_number_id>
//
// Imprime:
//   1. o SQL para guardar a chave PRIVADA em internal_secrets (RLS deny-all,
//      lida só com service role) — nunca em env var, decisão do PRD: é chave
//      privada, não API key;
//   2. o arquivo da chave PÚBLICA para subir à Meta, e o curl do upload.
//
// A privada é impressa uma única vez e não fica em disco: quem rodar decide
// onde colar. Se perder, gere outro par e refaça o upload — não há recuperação.

const phoneNumberId = Deno.args[0];
if (!phoneNumberId) {
  console.error("uso: deno run -A scripts/gerar-chave-flow.ts <phone_number_id>");
  Deno.exit(1);
}

const par = await crypto.subtle.generateKey(
  {
    name: "RSA-OAEP",
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: "SHA-256",
  },
  true,
  ["encrypt", "decrypt"],
);

function pem(tipo: "PUBLIC" | "PRIVATE", der: ArrayBuffer): string {
  const bytes = new Uint8Array(der);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64 = btoa(bin).replace(/(.{64})/g, "$1\n").trimEnd();
  return `-----BEGIN ${tipo} KEY-----\n${b64}\n-----END ${tipo} KEY-----`;
}

const publica = pem("PUBLIC", await crypto.subtle.exportKey("spki", par.publicKey));
const privada = pem("PRIVATE", await crypto.subtle.exportKey("pkcs8", par.privateKey));

const arquivoPublica = `chave-publica-${phoneNumberId}.pem`;
await Deno.writeTextFile(arquivoPublica, publica + "\n");

console.log(`
=== 1. CHAVE PRIVADA — guardar em internal_secrets ===
Rode este SQL (psql/SQL Editor), NÃO commite em lugar nenhum:

insert into internal_secrets (key, value) values (
  'flow_private_key:${phoneNumberId}',
  $chave$${privada}$chave$
) on conflict (key) do update set value = excluded.value, updated_at = now();

=== 2. CHAVE PÚBLICA — subir para a Meta ===
Escrita em ./${arquivoPublica}

curl -X POST \\
  "https://graph.facebook.com/v23.0/${phoneNumberId}/whatsapp_business_encryption" \\
  -H "Authorization: Bearer <ACCESS_TOKEN_DO_NUMERO>" \\
  -F "business_public_key=@${arquivoPublica}"

Conferir depois (o status precisa ser VALID):

curl -s "https://graph.facebook.com/v23.0/${phoneNumberId}/whatsapp_business_encryption\\
?fields=business_public_key,business_public_key_signature_status" \\
  -H "Authorization: Bearer <ACCESS_TOKEN_DO_NUMERO>"

Reenviar a chave é necessário quando o número é re-registrado ou quando chegam
webhooks 'public-key-missing' / 'public-key-signature-verification'.
`);
