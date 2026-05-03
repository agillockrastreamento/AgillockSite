# Roadmap — Integração Traccar ao AgilLock

> Documentação de referência: `docs/traccar/`.
> Checklist de testes detalhado: `docs/traccar/TESTES.md`.

## Fluxo de trabalho

O dispositivo GT06 usa rede celular e precisa de IP público — qualquer teste que envolva o aparelho físico é feito **diretamente em produção**.

```
Implementação local               Produção (Hostinger)
──────────────────────────        ────────────────────────────────
Escreve código                    git pull → docker compose up -d
Testa lógica via Postman          Testa com dispositivo físico real
  (localhost:3000 sem device)       (api.agillock.com.br com device)
Desenvolve frontend               Valida comportamento visual real
         │
         └── commit → push ──────────────────────────────────────►
```

---

## v1 — Rastreamento em tempo real ✅ Concluído

Esta é a primeira versão funcional completa do módulo de rastreamento. Cobre desde o deploy do Traccar até o frontend com mapa ao vivo e tela de histórico.

### Etapa 1a — Deploy do Traccar (dev) ✅ Concluído
Traccar rodando localmente, banco criado, conta admin criada.
Testes concluídos: `TESTES.md` → Fase 1.1 e 1.2 ✅

### Etapa 1b — Deploy do Traccar (produção) ✅ Concluído
Traccar rodando em produção (Hostinger), banco `traccar` criado, porta 5023 aberta, conta admin criada via API.
Testes concluídos: `TESTES.md` → Fase 1.3 ✅

**Referências:** `docs/traccar/DEPLOY.md`

---

### Etapa 2 — GT06 em produção ✅ Concluído
Aparelho GPS configurado via SMS, enviando posições reais para o Traccar de produção.

**O que foi feito:**
1. IMEI descoberto via SMS `IMEI#`
2. Dispositivo cadastrado no Traccar via API (`POST /api/devices`)
3. Aparelho configurado via SMS: APN, `SERVER`, `RESET`
4. Posições confirmadas chegando em `tc_positions`

**Testes concluídos:** `TESTES.md` → Fase 1.4 e Fase 2 ✅

**Referências:** `docs/traccar/PROTOCOLOS.md`

---

### Etapa 3 — Backend Node.js ✅ Concluído
Backend consumindo a API REST do Traccar e expondo WebSocket para o frontend.

**O que foi implementado:**
- `backend/src/services/traccar.service.ts` — todas as funções de acesso à API Traccar (dispositivos, posições, histórico, viagens, paradas, eventos, resumo, comandos)
- `backend/src/services/traccar.ws.ts` — bridge WebSocket: conecta ao Traccar, transforma mensagens e repassa para todos os clientes frontend conectados em `/ws/rastreamento`
- `backend/src/routes/rastreamento.routes.ts` — rotas REST completas (ver `docs/traccar/API.md`)

**Testes concluídos:** `TESTES.md` → Fase 3 e Fase 4 ✅

**Referências:** `docs/traccar/INTEGRACAO_BACKEND.md`

---

### Etapa 4 — Frontend: tela `rastreamento.html` ✅ Concluído
Mapa ao vivo com todos os veículos, sidebar, card de detalhe e atualizações em tempo real via WebSocket.

**O que foi implementado:**
- Mapa Leaflet com 3 camadas de tile (CartoDB Voyager padrão, OSM, ESRI) + seletor de camadas
- Marcadores com ícone FontAwesome por categoria de veículo (carro, moto, caminhão, etc.) e cor por status (azul = movimento, verde = parado online, laranja = offline com posição)
- Cluster customizado por proximidade em pixels — adapta ao zoom automaticamente; clique abre spider
- Sidebar: contadores online/offline, busca com dropdown (máx 8 resultados), tempo decorrido
- Card de detalhe do dispositivo selecionado: velocímetro SVG, ignição, bateria, 3 timestamps (GPS/dispositivo/servidor), geocodificação reversa via Nominatim (com cache), modo foco (esconde outros marcadores e acompanha o veículo)
- WebSocket com reconexão automática (5s) e badge de status (conectado/reconectando/desconectado)
- Cache local (`localStorage`) do snapshot inicial para carregamento instantâneo
- Botões no card: "Relatório" → `relatorio.html?id=` e "Histórico" → `rastreamento-detalhe.html?id=`

**Testes concluídos:** `TESTES.md` → Fase 5 ✅

**Referências:** `docs/traccar/FRONTEND_RASTREAMENTO.md`

---

### Etapa 5 — Tela de detalhes/histórico `rastreamento-detalhe.html` ✅ Concluído
Tela com percurso histórico no mapa, viagens e métricas do período.

**O que foi implementado:**
- Polyline azul do rastro histórico com marcadores de início (verde) e fim (vermelho)
- Marcador da posição atual do veículo (mesmo ícone da tela principal)
- Seletor de período: botões Hoje/Ontem/7 dias + inputs de data customizados (com fuso horário correto)
- Stats do período: distância total, velocidade máxima, tempo em movimento, número de viagens
- Lista de viagens com horário início→fim, duração, distância, vel. máxima; clique destaca trecho no mapa (polyline vermelha)
- Sobreposição "sem dados" quando o período não tem posições
- Loading overlay durante requisição; exibição de erro se falhar
- Impressão CSS (`@media print`) — esconde mapa e controles, mostra apenas dados

**Testes concluídos:** `TESTES.md` → Fase 3.3 e 3.4 ✅

**Referências:** `docs/traccar/FRONTEND_RASTREAMENTO.md`

---

### Etapa 6 — Estabilidade e validação contínua ✅ Concluído
Sistema funcionando de forma contínua em produção, filtros de posição inválida ativos no Traccar, sem memory leak detectado.

---

## Estado atual — v1

| Etapa | Status | Observações |
|---|---|---|
| 1a — Deploy dev | ✅ Concluído | Traccar local rodando |
| 1b — Deploy produção | ✅ Concluído | Traccar em produção, porta 5023 aberta |
| 2 — GT06 em produção | ✅ Concluído | Dispositivo enviando posições reais |
| 3 — Backend Node.js | ✅ Concluído | REST + WebSocket implementados |
| 4 — Frontend mapa | ✅ Concluído | rastreamento.html com cluster, spider, card |
| 5 — Tela detalhes | ✅ Concluído | rastreamento-detalhe.html com histórico |
| 6 — Estabilidade | ✅ Concluído | Sistema estável em produção |

---

## v2 — Portal do Cliente + recursos avançados ✅ Concluído

O portal do cliente e os recursos avançados de rastreamento foram implementados. A referência atual dos contratos está em `docs/traccar/API.md` e `docs/projeto/API.md`.

### Etapa 7 — Login do cliente e portal ✅ Concluído

| Item | Status | Referência |
|---|---|---|
| Login unificado com `ClienteLogin` e JWT `CLIENTE` | Concluído | `POST /api/auth/login` |
| CRUD administrativo do login do cliente | Concluído | `/api/clientes/:id/login` |
| Portal web do cliente | Concluído | `AgillockSite/cliente/` |
| Rastreamento filtrado por cliente | Concluído | `/api/cliente/rastreamento/posicoes` |
| Bloqueio por inadimplência > 10 dias | Concluído | `/api/cliente/rastreamento/status-acesso` |
| Upload de foto do veículo pelo cliente | Concluído | `/api/cliente/dispositivos/:dispositivoId/foto` |
| Pagamentos do cliente | Concluído | `/api/cliente/boletos` |
| Preferências do portal | Concluído | `/api/cliente/rastreamento/prefs` |

### Etapa 8 — Funcionalidades avançadas de rastreamento ✅ Concluído

| Funcionalidade | Status | Referência |
|---|---|---|
| Geocodificação reversa no backend | Concluído | `/api/*/rastreamento/geocode/reverse` |
| Geocercas admin e cliente | Concluído | `/api/rastreamento/geocercas`, `/api/cliente/rastreamento/geocercas` |
| Alertas de velocidade, ignição, geocerca, energia e km | Concluído | `/api/cliente/notificacoes/*` |
| Comandos remotos | Concluído | `/api/*/dispositivos/:id/comandos` |
| Relatórios em lote e exportação XLSX | Concluído | `/api/*/rastreamento/relatorios/*` |
| Medidores de sistema | Concluído | `/api/rastreamento/dispositivos/:id/medidores` |
| Manutenções | Concluído | `/api/cliente/manutencoes/*` |

## Próxima etapa — App mobile React Native Expo

O backend, banco, site e integração Traccar estão prontos para o planejamento do app mobile. O app deve partir das rotas do cliente documentadas em `docs/projeto/API.md` e `docs/traccar/API.md`.
