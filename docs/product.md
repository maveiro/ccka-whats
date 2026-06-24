# Produto — Contexto para Decisões Técnicas

## Problema que resolve

Empresas brasileiras usam WhatsApp como canal principal de negócio,
mas não têm visibilidade do que acontece nessas conversas.
Quando um colaborador sai, o histórico vai junto.
Não há como saber volume, tempo de resposta, ou pendências em aberto.

## Usuários

**Admin (gestor):**
- Quer ver todos os números da empresa e status de cada um
- Quer saber se alguém não está respondendo
- Quer o histórico de um colaborador que saiu
- Quer conectar novos números sem precisar de TI

**Operator (colaborador):**
- Quer ver suas próprias mensagens no computador
- Não quer que outros vejam suas conversas
- Não quer mudar como usa o WhatsApp

## Fase 1 — MVP (agora)

Funcionalidades mínimas para validar:
- [ ] Captura de mensagens de 1 número (pessoal do founder)
- [ ] Login e acesso ao painel
- [ ] Lista de conversas e mensagens
- [ ] Busca simples por texto
- [ ] Status da sessão (online/offline)

**Não construir ainda:** analytics, embeddings, integrações, multi-tenant UI.
A arquitetura suporta, mas a UI espera validação.

## Fase 2 — Corporativo

- Múltiplos números da equipe
- Painel admin com gestão de sessões
- Analytics básico: volume por número, tempo de resposta
- Backup/exportação de histórico
- Alertas de mensagem sem resposta

## Fase 3 — Inteligência

- Busca semântica (RAG + Claude)
- Transcrição automática de áudios
- Integração com Monday.com e CRM
- Agente Hermes com contexto de conversas
- SaaS multi-tenant para outras empresas

## Decisões de UX que importam

1. **Simplicidade acima de features** — o admin precisa conectar um número
   em menos de 2 minutos sem documentação

2. **QR code deve funcionar no mobile** — o admin vai escanear pelo celular
   enquanto olha para o computador; o QR precisa ser grande e claro

3. **Status em tempo real é crítico** — saber que uma sessão caiu
   imediatamente, não na próxima vez que alguém abrir o painel

4. **Privacidade visível** — o operador precisa ver claramente
   que apenas o admin tem acesso às suas mensagens, não outros operadores
