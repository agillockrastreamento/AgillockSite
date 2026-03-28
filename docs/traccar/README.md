# Documentação Traccar — AgilLock Rastreamento

Este diretório contém toda a documentação técnica de integração do **Traccar** ao sistema AgilLock.

## O que é o Traccar?

Traccar é uma plataforma de rastreamento GPS **open-source (Apache 2.0)** — uso comercial e privado são permitidos sem restrições, bastando manter a atribuição. É um projeto maduro e ativo: v6.12.2 (fevereiro/2026), 9.500+ commits, 200+ contribuidores.

**Por que usar o Traccar no AgilLock?**
- Suporta +2.000 modelos de dispositivos GPS e +200 protocolos
- REST API + WebSocket completos para integração com qualquer backend
- Pode ser hospedado em servidor próprio (self-hosted)
- Não tem custo de licença

---

## Arquitetura geral

```
Dispositivos GPS (GT06, Teltonika, etc.)
        |
        | TCP/UDP (protocolo proprietário, porta 5023 para GT06)
        ↓
 ┌─────────────────────┐
 │   Traccar Server    │  ← Java, porta 8082 (HTTP/API/WebUI)
 │   (Docker)          │    porta 5023 (GT06 protocol)
 └─────────┬───────────┘
           │ REST API + WebSocket
           ↓
 ┌─────────────────────┐
 │  Backend AgilLock   │  ← Node.js + Express + Prisma
 │  (Express routes)   │
 └─────────┬───────────┘
           │ API REST interna
           ↓
 ┌─────────────────────┐
 │ Frontend AgillockSite│  ← Bootstrap 3 + jQuery
 │ (tela rastreamento) │
 └─────────────────────┘
```

O backend Node.js atua como **intermediário**: consulta o Traccar, une os dados com informações do banco AgilLock (clientes, contratos, placas) e entrega ao frontend.

---

## Índice dos documentos

| Arquivo | Conteúdo |
|---|---|
| [ROADMAP.md](./ROADMAP.md) | **Etapas de implementação com critérios de conclusão** |
| [TESTES.md](./TESTES.md) | Checklist de testes por fase (conectividade → API → backend → frontend → produção) |
| [ARQUITETURA.md](./ARQUITETURA.md) | Componentes do Traccar, modelo de dados, fluxo de dados |
| [DEPLOY.md](./DEPLOY.md) | Deploy via Docker no mesmo docker-compose do projeto (PostgreSQL) |
| [PROTOCOLOS.md](./PROTOCOLOS.md) | Protocolos GPS suportados, portas, configuração do dispositivo GT06 |
| [BANCO_DE_DADOS.md](./BANCO_DE_DADOS.md) | Schema do banco, tabelas principais, relação com AgilLock |
| [API.md](./API.md) | REST API completa: endpoints, autenticação, exemplos, WebSocket |
| [INTEGRACAO_BACKEND.md](./INTEGRACAO_BACKEND.md) | `traccar.service.ts`, `traccar.ws.ts`, rotas REST — código completo |
| [FRONTEND_RASTREAMENTO.md](./FRONTEND_RASTREAMENTO.md) | HTML + JS completo da tela rastreamento.html com WebSocket e Leaflet |

---

## Status das etapas

| Etapa | Status |
|---|---|
| 1 — Deploy Traccar (Docker + PostgreSQL) | ⬜ Pendente |
| 2 — Conectar dispositivo GT06 | ⬜ Pendente |
| 3 — Backend: `traccar.service.ts` + WebSocket bridge + rotas | ⬜ Pendente |
| 4 — Frontend: `rastreamento.html` com mapa e WebSocket | ⬜ Pendente |
| 5 — Tela de detalhes do veículo (histórico + viagens) | ⬜ Pendente |
| 6 — Funcionalidades avançadas (geofences, alertas, etc.) | ⬜ Futuro |

Ver detalhes completos de cada etapa em [ROADMAP.md](./ROADMAP.md).
