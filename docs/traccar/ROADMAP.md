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
- `backend/src/routes/rastreamento.routes.ts` — rotas REST completas (ver `API_BACKEND.md`)

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

## v2 — Portal do Cliente + melhorias globais de UI

Planejadas após a v1 estar operando de forma estável. Especificação completa em `docs/traccar/PORTAL_CLIENTE.md`.

### Etapa 7 — Login do cliente e portal (próxima fase)

| Item | Descrição | Arquivo(s) |
|---|---|---|
| **Sidebar minimizável** | Todos os perfis (admin, colaborador, vendedor, cliente) — apenas ícones quando collapsed, favicon como logo | `admin.css` + JS global |
| **index.html** | Remover dropdown "Acessar" — botão único → `admin/login.html` | `index.html` |
| **Backend login cliente** | Model `ClienteLogin` + rotas de CRUD + JWT separado para o portal | `schema.prisma` + novas rotas |
| **Tab "Login" em cliente-detalhe** | Admin e colaborador gerenciam login do cliente; admin controla permissões do colaborador | `admin/cliente-detalhe.html`, `colaborador/cliente-detalhe.html` |
| **Portal do cliente** | `cliente/login.html` + auth-guard próprio + JWT com perfil (responsável/vinculado) | `cliente/login.html`, `auth-guard-cliente.js` |
| **Rastreamento do cliente** | Mesmo mapa ao vivo, com barra de veículos no rodapé (foto, placa, marca/modelo), overlay para histórico/relatório em vez de navegação | `cliente/rastreamento.html`, `rastreamento-cliente.js` |
| **Bloqueio por inadimplência** | Se boleto vencido > 10 dias, modal bloqueante na entrada do rastreamento | Backend + frontend |
| **Foto do veículo pelo cliente** | Upload separado da foto do admin; aparece apenas na tela do cliente | `POST /api/clientes/dispositivos/:id/foto` |
| **Pagamentos do cliente** | Lista de boletos, filtros, segunda via — apenas para Cliente Responsável | `cliente/pagamentos.html` |

### Etapa 8 — Funcionalidades avançadas de rastreamento (futuro)

| Funcionalidade | Descrição |
|---|---|
| Geocodificação reversa no backend | Endereço já resolvido na API, não no browser |
| Geofences | Cercas virtuais por cliente/dispositivo |
| Alertas de velocidade | Notificação quando ultrapassar limite configurado |
| Alertas de ignição | Notificação ao ligar/desligar o veículo |
| Comandos remotos | Solicitar posição, bloquear/desbloquear veículo (`comandos.html` já existe na sidebar) |
| Tela de relatório | `relatorio.html` — histórico avançado por período (link já existe no card) |
