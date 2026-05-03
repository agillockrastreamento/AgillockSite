# Documentação Traccar - AgilLock Rastreamento

Atualizado em: 2026-05-03

Esta pasta documenta a integração do AgilLock com o Traccar, incluindo API REST, WebSocket, relatórios, geocercas, comandos, notificações e portal/app do cliente.

## Papel do Traccar

O Traccar recebe dados dos rastreadores GPS por protocolo TCP/UDP, persiste posições no banco dele e expõe REST API + WebSocket. O backend AgilLock atua como camada intermediária:

```text
Rastreador GPS
  -> Traccar Server
  -> Backend AgilLock
  -> Site admin/cliente e futuro app mobile
```

O frontend e o app não acessam o Traccar diretamente. Eles consomem `/api/rastreamento/*`, `/api/cliente/rastreamento/*` e `/ws/rastreamento`.

## Documentos

| Arquivo | Conteúdo |
|---|---|
| [API.md](./API.md) | Contratos atuais da API de rastreamento, WebSocket e endpoints Traccar internos |
| [INTEGRACAO_BACKEND.md](./INTEGRACAO_BACKEND.md) | Como o backend integra Prisma, Traccar REST e WebSocket |
| [ARQUITETURA.md](./ARQUITETURA.md) | Visão de componentes e fluxo de dados |
| [BANCO_DE_DADOS.md](./BANCO_DE_DADOS.md) | Tabelas do Traccar e vínculo com o banco AgilLock |
| [DEPLOY.md](./DEPLOY.md) | Deploy do Traccar no Docker |
| [PROTOCOLOS.md](./PROTOCOLOS.md) | Protocolos e portas de rastreadores |
| [FRONTEND_RASTREAMENTO.md](./FRONTEND_RASTREAMENTO.md) | Implementação web da tela de rastreamento |
| [PORTAL_CLIENTE.md](./PORTAL_CLIENTE.md) | Rastreamento no portal do cliente |
| [TESTES.md](./TESTES.md) | Checklist de testes |
| [ROADMAP.md](./ROADMAP.md) | Histórico de implementação |
| [NOVO_PROTOCOLO.md](./NOVO_PROTOCOLO.md) | Como adicionar novo protocolo/dispositivo |

## Estado atual

| Área | Status |
|---|---|
| Deploy Traccar com PostgreSQL | Concluído |
| Cadastro/sincronização de dispositivos | Concluído |
| REST API de rastreamento admin | Concluído |
| REST API de rastreamento cliente | Concluído |
| WebSocket bridge `/ws/rastreamento` | Concluído |
| Histórico, viagens, paradas, eventos e resumo | Concluído |
| Relatórios em lote e exportação XLSX | Concluído |
| Comandos para dispositivos | Concluído |
| Geocercas admin e cliente | Concluído |
| Medidores de sistema | Concluído |
| Notificações por evento/km/manutenção | Concluído |
| Portal web do cliente | Concluído |
| App mobile React Native Expo | Próxima etapa |

## Pontos importantes para o app mobile

- Login: `POST /api/auth/login`, usando apenas usuários com `role: CLIENTE`.
- Snapshot inicial: `GET /api/cliente/rastreamento/posicoes`.
- Tempo real: `wss://api.agillock.com.br/ws/rastreamento`.
- O WebSocket entrega `deviceId` como `traccarId`; o app deve mapear para `dispositivoId` usando o snapshot.
- Rotas do cliente bloqueiam rastreamento com `403 { "error": "acesso_bloqueado" }` quando há inadimplência superior a 10 dias.
- Preferências, notificações, geocercas e manutenções já possuem API própria para uso no app.
