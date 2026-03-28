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

## Visão geral das etapas

```
Etapa 1    →   Etapa 2   →   Etapa 3   →   Etapa 4   →   Etapa 5   →   Etapa 6
Deploy dev     Deploy prod   GT06 prod     Backend       Frontend      Detalhe
+ testes 1.1   + testes 1.3  + testes 1.4  + testes 3    + testes 5    veículo
    1.2         infra         2 API REST    4 WebSocket
```

---

## Etapa 1 — Deploy do Traccar

### 1a — Desenvolvimento ✅ Concluído

Traccar rodando localmente, banco criado, conta admin criada.
Testes concluídos: `TESTES.md` → Fase 1.1 e 1.2 ✅

### 1b — Produção (Hostinger) *(próximo passo)*

**Objetivo:** Traccar rodando no servidor com o `docker-compose.yml`, banco `traccar` criado, porta 5023 aberta.

**O que fazer no servidor (SSH):**

1. Puxar as atualizações:
   ```bash
   cd /caminho/do/projeto && git pull origin main
   ```

2. Abrir a porta 5023 no firewall:
   ```bash
   ufw allow 5023/tcp && ufw reload
   ```

3. Criar o banco `traccar`:
   ```bash
   docker compose exec postgres psql -U agillock_user -d agillock -c "CREATE DATABASE traccar;"
   ```

4. Adicionar variáveis ao `.env` do servidor:
   ```bash
   echo "" >> backend/.env
   echo "TRACCAR_URL=http://traccar:8082" >> backend/.env
   echo "TRACCAR_USER=admin@agillock.com.br" >> backend/.env
   echo "TRACCAR_PASSWORD=SenhaSeguraTraccar123" >> backend/.env
   ```

5. Subir o Traccar:
   ```bash
   cd backend && docker compose up -d traccar
   docker compose logs -f traccar
   ```
   Aguardar `Liquibase: Update has been successful`.

6. Criar conta admin do Traccar via API:
   ```bash
   curl -X POST http://localhost:8082/api/users \
     -H "Content-Type: application/json" \
     -d '{"name":"Admin","email":"admin@agillock.com.br","password":"SenhaSeguraTraccar123","administrator":true}'
   ```

**Critério de conclusão:** `docker compose ps traccar` mostra `Up`, tabelas criadas no banco, sem erros nos logs.

**Testes desta etapa:** `TESTES.md` → Fase 1.3 (infraestrutura de produção)

**Referências:** `docs/traccar/DEPLOY.md`

---

## Etapa 2 — Conectar o dispositivo GT06 *(produção)*

**Objetivo:** Aparelho GPS enviando posições reais para o Traccar de produção.

**O que fazer:**

1. Descobrir o IMEI — enviar SMS para o chip do dispositivo:
   ```
   IMEI#
   ```

2. Cadastrar no Traccar via SSH no servidor:
   ```bash
   curl -X POST http://localhost:8082/api/devices \
     -u "admin@agillock.com.br:SenhaSeguraTraccar123" \
     -H "Content-Type: application/json" \
     -d '{"name":"Teste GT06","uniqueId":"IMEI_AQUI","category":"car"}'
   ```

3. Configurar o aparelho via SMS:
   ```
   APN,OPERADORA#
   SERVER,0,seudominio.com.br,5023,0#
   RESET#
   ```

4. Confirmar posições chegando:
   ```bash
   docker compose exec postgres psql -U agillock_user -d traccar \
     -c "SELECT id, latitude, longitude, fixtime FROM tc_positions ORDER BY fixtime DESC LIMIT 5;"
   ```

**Critério de conclusão:** Dispositivo aparece `online` na API do Traccar e posições chegam em `tc_positions`.

**Testes desta etapa:** `TESTES.md` → Fase 1.4 e Fase 2

**Referências:** `docs/traccar/PROTOCOLOS.md`

---

## Etapa 3 — Backend Node.js *(implementação local, testes via Postman)*

**Objetivo:** Backend consumindo a API do Traccar e expondo WebSocket para o frontend.

**O que fazer (local):**

1. Instalar dependência:
   ```bash
   cd backend && npm install ws && npm install --save-dev @types/ws
   ```
2. Criar `backend/src/services/traccar.service.ts` — ver código completo em `INTEGRACAO_BACKEND.md`
3. Criar `backend/src/services/traccar.ws.ts` — ver código completo em `INTEGRACAO_BACKEND.md`
4. Criar `backend/src/routes/rastreamento.routes.ts` — ver código completo em `INTEGRACAO_BACKEND.md`
5. Registrar rota em `app.ts`: `app.use('/api/rastreamento', rastreamentoRoutes)`
6. Ajustar `server.ts`/`index.ts` para usar `http.createServer` e chamar `initTraccarWebSocket`
7. Commit + push + pull no servidor + `docker compose up -d --build backend`

**Testes — 2 momentos:**

| Momento | Onde testar | O que valida |
|---|---|---|
| Antes do push (lógica) | Postman → `localhost:3000` | Rota responde sem `502`, estrutura do JSON |
| Após deploy (dados reais) | Postman → `api.agillock.com.br` | Posições reais, velocidade em km/h, `traccarId` preenchido |

**Critério de conclusão:**
- `GET /api/rastreamento/posicoes` retorna dispositivo com `posicao` preenchida em produção
- Logs do backend mostram `[WS Traccar] Conectado.`

**Testes desta etapa:** `TESTES.md` → Fase 3 e Fase 4

**Referências:** `docs/traccar/INTEGRACAO_BACKEND.md`

---

## Etapa 4 — Frontend: tela `rastreamento.html` *(implementação local, validação em produção)*

**Objetivo:** Mapa com veículos, atualizando em tempo real via WebSocket.

**O que fazer (local):**

1. Criar `AgillockSite/admin/rastreamento.html` — ver código completo em `FRONTEND_RASTREAMENTO.md`
2. Criar `AgillockSite/admin/rastreamento.js` — ver código completo em `FRONTEND_RASTREAMENTO.md`
3. Adicionar link "Rastreamento" na navbar do painel admin
4. Commit + push (frontend é estático, não precisa rebuild do backend)

**Validação em produção:**
- Abrir a tela no browser apontando para produção
- Verificar marcador no mapa, sidebar, badge WebSocket verde, atualização em tempo real ao mover o dispositivo

**Critério de conclusão:** Mapa com marcador do dispositivo, badge `● Tempo real ativo`, marcador move sem recarregar a página.

**Testes desta etapa:** `TESTES.md` → Fase 5

**Referências:** `docs/traccar/FRONTEND_RASTREAMENTO.md`

---

## Etapa 5 — Tela de detalhes do veículo *(implementação local, validação em produção)*

**Objetivo:** Tela com histórico de percurso, viagens e eventos do período.

**O que fazer (local):**

1. Criar `AgillockSite/admin/rastreamento-detalhe.html`
2. Criar `AgillockSite/admin/rastreamento-detalhe.js`
3. Funcionalidades:
   - Mapa com **polyline** do percurso (usando `GET /api/rastreamento/dispositivos/:id/historico`)
   - Seletor de data (padrão: hoje)
   - Tabela de viagens: origem, destino, distância, duração, velocidade máxima
   - Indicadores: km do dia, velocidade máxima, horas em movimento
4. Commit + push

**Critério de conclusão:** Tela exibe rastro do percurso real do dispositivo com tabela de viagens.

**Testes desta etapa:** `TESTES.md` → Fase 3.3 e 3.4

**Referências:** `docs/traccar/FRONTEND_RASTREAMENTO.md`, `docs/traccar/API.md`

---

## Etapa 6 — Estabilidade e validação contínua *(produção)*

**Objetivo:** Confirmar estabilidade após uso contínuo real — filtros funcionando, sem memory leak, posições inválidas descartadas.

**O que fazer (no servidor):**

1. Deixar o dispositivo rodando por ~30 minutos
2. Verificar filtros no banco:
   ```bash
   docker compose exec postgres psql -U agillock_user -d traccar -c "
   SELECT COUNT(*) as total,
          COUNT(*) FILTER (WHERE valid = false) as invalidas,
          COUNT(*) FILTER (WHERE latitude = 0 AND longitude = 0) as zeradas
   FROM tc_positions;"
   ```
3. Monitorar consumo de memória:
   ```bash
   docker stats --no-stream
   ```

**Critério de conclusão:** Zero posições inválidas no banco, memória estável, sistema funcional após 30min.

**Testes desta etapa:** `TESTES.md` → Fase 6

---

## Etapa 7 — Funcionalidades avançadas (futuro)

Planejadas após a Etapa 6 estar estável:

| Funcionalidade | Descrição |
|---|---|
| Geocodificação reversa | Endereço nos popups (Nominatim, sem API key) |
| Geofences | Cercas virtuais por cliente/dispositivo |
| Alertas de velocidade | Notificação quando ultrapassar limite configurado |
| Alertas de ignição | Notificação ao ligar/desligar o veículo |
| Relatório mensal | Distância total, viagens, horas rodadas por período |
| Portal do cliente | Cliente vê seus próprios veículos rastreados |
| Comandos remotos | Solicitar posição, bloquear/desbloquear veículo |

---

## Estado atual

| Etapa | Status | Observações |
|---|---|---|
| 1a — Deploy dev | ✅ Concluído | Traccar rodando, banco criado, conta admin criada |
| 1b — Deploy produção | ⬜ Pendente | Próximo passo |
| 2 — GT06 em produção | ⬜ Pendente | Aguarda Etapa 1b |
| 3 — Backend Node.js | ⬜ Pendente | Pode implementar localmente já |
| 4 — Frontend mapa | ⬜ Pendente | Aguarda Etapa 3 deployada |
| 5 — Tela detalhes | ⬜ Pendente | Aguarda Etapa 4 |
| 6 — Estabilidade | ⬜ Pendente | Aguarda Etapa 5 |
| 7 — Avançado | ⬜ Futuro | |

---

## Ordem de execução

```
Etapa 1b (Deploy prod) ──▶ Etapa 2 (GT06) ────┐
                                                 ├──▶ Etapa 4 (Frontend) ──▶ Etapa 5 (Detalhe) ──▶ Etapa 6
Etapa 3 (Backend) ───────────────────────────────┘
  (pode implementar em paralelo com 1b e 2)
```
