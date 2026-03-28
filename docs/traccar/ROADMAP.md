# Roadmap — Integração Traccar ao AgilLock

> Documentação de referência para cada etapa: ver os arquivos em `docs/traccar/`.
> Checklist de testes detalhado: ver `docs/traccar/TESTES.md`.

---

## Visão geral

```
Etapa 1 → Etapa 2 → Etapa 3 → Etapa 4 → Etapa 5 → Etapa 6 → Deploy
 Deploy    GT06     Backend   Frontend  Detalhe   Testes    Produção
 Traccar   Config   Node.js    Mapa     Veículo   Filtros   Hostinger
```

Cada etapa de implementação tem uma fase de testes associada em `TESTES.md`.

---

## Etapa 1 — Deploy do Traccar em desenvolvimento

**Objetivo:** Traccar rodando localmente via `docker-compose.dev.yml`, banco `traccar` criado, Web UI acessível.

> Os arquivos `docker-compose.dev.yml`, `traccar/traccar.dev.xml` e `traccar/traccar.xml` **já foram criados**. Só executar os comandos abaixo.

**O que fazer:**

1. Criar o banco `traccar` no PostgreSQL dev (apenas uma vez):
   ```bash
   cd backend
   docker compose -f docker-compose.dev.yml up -d postgres
   docker compose -f docker-compose.dev.yml exec postgres \
     psql -U agillock_user -c "CREATE DATABASE traccar;"
   ```

2. Subir todos os serviços:
   ```bash
   docker compose -f docker-compose.dev.yml up -d
   ```

3. Verificar logs do Traccar:
   ```bash
   docker compose -f docker-compose.dev.yml logs -f traccar
   ```
   Aguardar `INFO: Server started`.

4. Acessar `http://localhost:8082` e criar conta admin:
   - Email: `admin@agillock.com.br`
   - Senha: `AdminTraccar@dev`

5. Adicionar ao `.env`:
   ```
   TRACCAR_URL=http://traccar:8082
   TRACCAR_USER=admin@agillock.com.br
   TRACCAR_PASSWORD=AdminTraccar@dev
   ```

**Critério de conclusão:** `http://localhost:8082` abre o Traccar, banco `traccar` tem tabelas criadas, sem erros nos logs.

**Testes desta etapa:** `TESTES.md` → Fase 1.1 e 1.2

**Referências:** `docs/traccar/DEPLOY.md`

---

## Etapa 2 — Conectar o dispositivo GT06 ao Traccar

**Objetivo:** Aparelho GPS enviando posições para o Traccar e aparecendo no mapa da Web UI.

**O que fazer:**

1. Descobrir o **IP local da sua máquina** na rede Wi-Fi/ethernet (não `localhost`):
   ```bash
   # Windows — procurar "Endereço IPv4" da sua rede ativa
   ipconfig
   # Exemplo: 192.168.1.10
   ```

2. Cadastrar o dispositivo no Traccar Web UI (`http://localhost:8082`):
   - Menu → Devices → `+`
   - Name: nome do veículo de teste
   - Identifier: IMEI do aparelho (15 dígitos, impresso no dispositivo)

3. Configurar o aparelho via SMS:
   ```
   APN,NOME_DO_APN#
   SERVER,0,192.168.1.10,5023,0#
   ```
   _(substituir `192.168.1.10` pelo IP real da sua máquina)_

4. Aguardar o dispositivo aparecer como **online** no Traccar Web UI
5. Verificar se as posições chegam no mapa da Web UI
6. Conferir logs se necessário:
   ```bash
   docker compose -f docker-compose.dev.yml logs -f traccar
   ```

**Critério de conclusão:** Dispositivo aparece online com posição válida na Web UI do Traccar.

**Testes desta etapa:** `TESTES.md` → Fase 1.3, 1.4 e Fase 2 (API REST)

**Referências:** `docs/traccar/PROTOCOLOS.md`

---

## Etapa 3 — Backend Node.js: serviço e rotas de rastreamento

**Objetivo:** Backend consumindo a API do Traccar e expondo WebSocket para o frontend.

**O que fazer:**

1. Instalar dependência WebSocket:
   ```bash
   cd backend && npm install ws && npm install --save-dev @types/ws
   ```
2. Criar `backend/src/services/traccar.service.ts` (código completo em `INTEGRACAO_BACKEND.md`)
   - Funções: `traccarGetDevices`, `traccarGetDeviceByImei`, `traccarGetPositions`, `traccarCreateDevice`, etc.
   - Autenticação por Basic Auth nas chamadas REST
   - Função `traccarGetSessionCookie()` para autenticar o WebSocket
3. Criar `backend/src/services/traccar.ws.ts` (código completo em `INTEGRACAO_BACKEND.md`)
   - Abre conexão WebSocket com Traccar (`ws://traccar:8082/api/socket`)
   - Redistribui mensagens para todos os clientes frontend conectados em `/ws/rastreamento`
   - Reconexão automática (5s após queda)
4. Criar `backend/src/routes/rastreamento.routes.ts` com as rotas REST:
   - `GET /api/rastreamento/posicoes` — snapshot inicial
   - `GET /api/rastreamento/dispositivos/:id/historico`
   - `GET /api/rastreamento/dispositivos/:id/viagens`
5. Ajustar `backend/src/app.ts`: registrar `rastreamentoRoutes`
6. Ajustar `backend/src/server.ts` (ou `index.ts`):
   - Criar `http.Server` explícito
   - Chamar `initTraccarWebSocket(httpServer)`
7. Verificar sincronização ao cadastrar dispositivo em `dispositivos.routes.ts`

**Critério de conclusão:**
- `GET http://localhost:3000/api/rastreamento/posicoes` retorna JSON com dispositivos e posições
- WebSocket `ws://localhost:3000/ws/rastreamento` conecta e recebe mensagens ao mover o dispositivo

**Testes desta etapa:** `TESTES.md` → Fase 3 e Fase 4

**Referências:** `docs/traccar/INTEGRACAO_BACKEND.md`

---

## Etapa 4 — Frontend: tela `rastreamento.html`

**Objetivo:** Tela de mapa com todos os veículos, atualizando em tempo real via WebSocket.

**O que fazer:**

1. Criar `AgillockSite/admin/rastreamento.html` (HTML completo em `FRONTEND_RASTREAMENTO.md`)
2. Criar `AgillockSite/admin/rastreamento.js` (JS completo em `FRONTEND_RASTREAMENTO.md`)
3. Adicionar link "Rastreamento" na navbar do painel admin

**Critério de conclusão:** Mapa exibindo veículo em tempo real, sidebar funcional, WebSocket conectado e ativo.

**Testes desta etapa:** `TESTES.md` → Fase 5

**Referências:** `docs/traccar/FRONTEND_RASTREAMENTO.md`

---

## Etapa 5 — Tela de detalhes do veículo

**Objetivo:** Tela `rastreamento-detalhe.html` com histórico de percurso e viagens.

**O que fazer:**

1. Criar `AgillockSite/admin/rastreamento-detalhe.html`
2. Criar `AgillockSite/admin/rastreamento-detalhe.js`
3. Funcionalidades:
   - Dados completos do dispositivo e cliente vinculado
   - Mapa com **polyline** do percurso do período selecionado
   - Seletor de data (hoje por padrão)
   - Tabela de viagens com origem, destino, distância, duração, velocidade máxima
   - Indicadores: km rodados no dia, velocidade máxima, horas em movimento

**Critério de conclusão:** Tela exibe rastro completo do percurso do dia com tabela de viagens.

**Testes desta etapa:** `TESTES.md` → Fase 3.3 e 3.4 (histórico e viagens)

**Referências:** `docs/traccar/FRONTEND_RASTREAMENTO.md`, `docs/traccar/API.md`

---

## Etapa 6 — Ativar filtros e validar comportamento de produção

**Objetivo:** Testar com os filtros de posição ativos para garantir que o comportamento em produção está correto antes de fazer o deploy.

**O que fazer:**

1. Editar `backend/traccar/traccar.dev.xml` — descomentar o bloco de filtros:
   ```xml
   <entry key='filter.enable'>true</entry>
   <entry key='filter.invalid'>true</entry>
   <entry key='filter.zero'>true</entry>
   <entry key='filter.duplicate'>true</entry>
   <entry key='filter.future'>600</entry>
   ```

2. Reiniciar o container Traccar:
   ```bash
   docker compose -f docker-compose.dev.yml restart traccar
   ```

3. Observar o comportamento durante ~30 minutos de uso real do dispositivo

**Critério de conclusão:** Todas as funcionalidades funcionam normalmente com filtros ativos, sem posições inválidas no banco.

**Testes desta etapa:** `TESTES.md` → Fase 6

---

## Etapa 7 — Deploy em produção (Hostinger)

**Objetivo:** Subir o Traccar no servidor de produção após validação completa em desenvolvimento.

**Pré-requisito:** Todas as etapas 1-6 concluídas e testadas.

**O que fazer:**

1. Adicionar serviço `traccar` ao `docker-compose.yml` de produção (ver `DEPLOY.md` — seção Produção)
2. Criar banco `traccar` no PostgreSQL de produção:
   ```bash
   docker compose exec postgres psql -U agillock_user -c "CREATE DATABASE traccar;"
   ```
3. Adicionar variáveis ao `.env` do servidor
4. Subir: `docker compose up -d`
5. Criar conta admin no Traccar de produção
6. Reconfigurar dispositivos via SMS apontando para o domínio de produção:
   ```
   SERVER,0,seudominio.com.br,5023,0#
   ```
7. Abrir porta `5023` TCP no firewall da Hostinger

**Critério de conclusão:** Dispositivos online no Traccar de produção, tela de rastreamento funcionando com tempo real.

**Testes desta etapa:** `TESTES.md` → Fase 7

**Referências:** `docs/traccar/DEPLOY.md` — seção Produção

---

## Etapa 8 — Funcionalidades avançadas (futuro)

Planejadas após o deploy em produção estar estável:

| Funcionalidade | Descrição |
|---|---|
| Geocodificação reversa | Endereço nos popups (Nominatim, sem API key) |
| Geofences | Cercas virtuais por cliente/dispositivo |
| Alertas de velocidade | Notificação quando ultrapassar limite configurado |
| Alertas de ignição | Notificação ao ligar/desligar o veículo |
| Relatório mensal | Distância total, viagens, horas rodadas por período |
| Portal do cliente | Cliente vê seus próprios veículos rastreados |
| Comandos remotos | Solicitar posição, bloquear/desbloquear veículo |
| Odômetro virtual | Integrar `totalDistance` do Traccar com o cadastro |

---

## Estado atual

| Etapa | Status | Observações |
|---|---|---|
| 1 — Deploy Traccar (dev) | ⬜ Pendente | Arquivos criados, só executar os comandos |
| 2 — Conectar GT06 | ⬜ Pendente | Aguarda Etapa 1 |
| 3 — Backend Node.js | ⬜ Pendente | Pode fazer em paralelo com Etapa 1 |
| 4 — Frontend mapa | ⬜ Pendente | Aguarda Etapas 2 e 3 |
| 5 — Tela detalhes | ⬜ Pendente | Aguarda Etapa 4 |
| 6 — Filtros + validação | ⬜ Pendente | Aguarda Etapas 4 e 5 |
| 7 — Deploy produção | ⬜ Pendente | Aguarda Etapa 6 |
| 8 — Avançado | ⬜ Futuro | |

---

## Ordem de execução

```
Etapa 1 (Deploy dev) ──┬──▶ Etapa 2 (GT06) ────┐
                       │                          ├──▶ Etapa 4 (Frontend) ──▶ Etapa 5 (Detalhe) ──▶ Etapa 6 (Filtros) ──▶ Etapa 7 (Prod)
Etapa 3 (Backend) ─────┘                          │
                       └──────────────────────────┘
```
