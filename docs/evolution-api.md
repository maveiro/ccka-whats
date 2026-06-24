# Evolution API — Configuração no VPS

## O que é

Evolution API é um wrapper HTTP sobre a biblioteca Baileys do WhatsApp.
Resolve nativamente: multi-sessão, reconexão automática, retry de webhook,
fila de eventos (via RabbitMQ opcional), painel de gerenciamento.

Repositório: https://github.com/EvolutionAPI/evolution-api

## Estrutura no VPS

```
infra/evolution/
├── docker-compose.yml
├── .env.example          ← copiar para .env e preencher
└── README.md
```

## Endpoints principais usados pela plataforma

| Método | Endpoint | Uso |
|--------|----------|-----|
| POST | `/instance/create` | Criar nova instância (número) |
| GET | `/instance/connect/{instance}` | Obter QR code |
| GET | `/instance/fetchInstances` | Listar todas as instâncias |
| GET | `/instance/connectionState/{instance}` | Status da conexão |
| DELETE | `/instance/delete/{instance}` | Remover instância |
| POST | `/webhook/set/{instance}` | Configurar webhook por instância |

## Convenção de nomes de instância

Usar o padrão: `{tenant_slug}-{phone_number}`
Exemplo: `welcome-trips-5541999887766`

Isso garante que o `session-health-check` consiga identificar
qual `wa_session` corresponde a cada instância do Evolution.

## Eventos webhook relevantes

O Evolution envia eventos com o campo `event`. Os que precisam ser processados:

| Evento | Ação |
|--------|------|
| `messages.upsert` | Inserir mensagem(ns) no banco |
| `connection.update` | Atualizar `wa_sessions.status` |
| `qrcode.updated` | Atualizar `wa_sessions.qr_code` |

Eventos ignorados por ora: `messages.update`, `presence.update`, `chats.upsert`.
O `raw_payload` os preserva caso sejam necessários futuramente.

## Segurança

- O Evolution expõe uma porta HTTP no VPS (padrão: 8080)
- Nunca expor essa porta diretamente na internet sem autenticação
- Usar `AUTHENTICATION_API_KEY` em todas as requisições
- A Edge Function envia esse key no header `Authorization: Bearer`
- Firewall VPS: bloquear porta 8080 para IPs externos, liberar apenas para
  os IPs do Supabase Edge Functions (ou usar rede privada se disponível)
