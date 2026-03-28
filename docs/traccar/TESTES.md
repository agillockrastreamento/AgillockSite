# Plano de Testes — Integração Traccar

> Execute os testes na ordem apresentada. Cada fase depende da anterior.
> Marque cada item com ✅ ao concluir. Registre problemas encontrados na tabela no final.

## Onde cada fase é executada

| Fase | Ambiente | Motivo |
|---|---|---|
| 1.1 e 1.2 — Traccar rodando | Desenvolvimento ✅ | Já concluído |
| 1.3 e 1.4 — Dispositivo conecta | **Produção** | GT06 precisa de IP público |
| 2 — API REST Traccar | **Produção** | Requer dispositivo online com posições reais |
| 3.1 — Conexão básica backend | Desenvolvimento ou Produção | Não requer dispositivo |
| 3.2 a 3.5 — Rotas com dados reais | **Produção** | Requer posições reais do dispositivo |
| 4 — WebSocket tempo real | **Produção** | Requer dispositivo enviando posições |
| 5 — Frontend mapa | **Produção** | Requer posições reais para validar comportamento |
| 6 — Filtros e estabilidade | **Produção** | Filtros já ativos em produção |

**Fluxo de trabalho para fases em produção:**
```
Implementa local → commit → push → pull no servidor → testa com dispositivo real
```

**Teste de rotas sem dispositivo (Postman):**
- Apontar para `http://localhost:3000` (dev local, sem posições reais) para testar se a rota responde
- Apontar para `https://api.agillock.com.br` (produção) para testar com dados reais do dispositivo

---

## Fase 1 — Conectividade Traccar

### 1.1 — Traccar rodando em desenvolvimento

- [✅] `http://localhost:8082` abre a tela de login
- [✅] Login com `admin@agillock.com.br` / `AdminTraccar@dev` funciona
- [✅] Menu lateral exibe Devices, Reports, Settings

### 1.2 — Banco de dados criado corretamente (desenvolvimento)

- [✅] Banco `traccar` existe com as tabelas `tc_devices`, `tc_positions`, `tc_users`, `tc_events`

### 1.3 — Traccar rodando em produção *(no servidor via SSH)*

- [ ] `docker compose ps traccar` mostra status `Up`
- [ ] `docker compose logs traccar` mostra `Liquibase: Update has been successful`
- [ ] Banco `traccar` criado no PostgreSQL de produção com as tabelas

```bash
# Verificar no servidor
docker compose exec postgres psql -U agillock_user -d traccar -c "\dt tc_*"
```

### 1.4 — Dispositivo GT06 se conecta ao Traccar de produção *(no servidor + SMS)*

1. Descobrir o IMEI enviando SMS para o chip do dispositivo:
   ```
   IMEI#
   ```
2. Cadastrar o dispositivo via API (executar no servidor via SSH):
   ```bash
   curl -X POST http://localhost:8082/api/devices \
     -u "admin@agillock.com.br:SENHA_TRACCAR" \
     -H "Content-Type: application/json" \
     -d '{"name":"Teste GT06","uniqueId":"IMEI_AQUI","category":"car"}'
   ```
3. Enviar SMS de configuração para o chip do dispositivo:
   ```
   APN,OPERADORA#
   SERVER,0,seudominio.com.br,5023,0#
   RESET#
   ```
4. Verificar conexão nos logs:
   ```bash
   docker compose logs -f traccar
   ```

- [ ] Dispositivo aparece com `"status": "online"` na API:
  ```bash
  curl -s http://localhost:8082/api/devices -u "admin@agillock.com.br:SENHA" | python3 -m json.tool
  ```
- [ ] Posições chegando em `tc_positions`:
  ```bash
  docker compose exec postgres psql -U agillock_user -d traccar \
    -c "SELECT id, deviceid, latitude, longitude, fixtime FROM tc_positions ORDER BY fixtime DESC LIMIT 5;"
  ```

**Problemas comuns:**
- Status permanece Unknown → APN errado ou porta 5023 não aberta no firewall da Hostinger
- Posição não aparece → dispositivo sem fix GPS (testar em área aberta)

---

## Fase 2 — API REST do Traccar *(produção — executar no servidor via SSH ou Postman)*

Objetivo: confirmar que a API do Traccar responde corretamente com dados reais do dispositivo.

> Todos os `curl` abaixo são executados **no servidor via SSH**. Alternativamente, usar Postman apontando para `https://api.agillock.com.br` (se o nginx tiver proxy para o Traccar configurado) ou via SSH tunnel.

### 2.1 — Listar dispositivos

```bash
curl -s http://localhost:8082/api/devices \
  -u "admin@agillock.com.br:SENHA_TRACCAR" | python3 -m json.tool
```

- [ ] Retorna array com o dispositivo cadastrado
- [ ] Campo `status` é `"online"`
- [ ] Campo `uniqueId` bate com o IMEI

### 2.2 — Última posição

```bash
curl -s "http://localhost:8082/api/positions?deviceId=ID_DO_DISPOSITIVO" \
  -u "admin@agillock.com.br:SENHA_TRACCAR" | python3 -m json.tool
```

- [ ] Retorna posição com `latitude` e `longitude` reais (não `0.0`)
- [ ] Campo `valid` é `true`
- [ ] `attributes.ignition` presente (`true` ou `false`)
- [ ] `speed` tem valor em knots (ex: `0.0` se parado, `10.8` se a ~20km/h)

### 2.3 — Histórico de posições

```bash
curl -s "http://localhost:8082/api/positions?deviceId=ID&from=2026-03-28T00:00:00Z&to=2026-03-28T23:59:59Z" \
  -u "admin@agillock.com.br:SENHA_TRACCAR" | python3 -m json.tool
```

- [ ] Retorna array de posições do período com mais de um item (após o dispositivo se mover)

---

## Fase 3 — Backend Node.js *(implementação local, testes via Postman em produção)*

Objetivo: confirmar que o backend AgilLock consome o Traccar corretamente.

> Pré-requisito: Etapa 3 do ROADMAP implementada e deployada no servidor.

### 3.1 — Conexão básica (sem dispositivo) *(desenvolvimento local)*

Testar antes mesmo de ter posições reais — só verifica se o backend consegue falar com o Traccar.

```
GET http://localhost:3000/api/rastreamento/posicoes
Authorization: Bearer <token_admin>
```

- [ ] Retorna `200` (não `502`)
- [ ] Response é um array (vazio se nenhum dispositivo do AgilLock tem IMEI cadastrado no Traccar)

### 3.2 — Dispositivo sincronizado entre AgilLock e Traccar *(Postman → produção)*

```
GET https://api.agillock.com.br/api/rastreamento/posicoes
Authorization: Bearer <token_admin>
```

- [ ] Cadastrar `Dispositivo` no AgilLock com o mesmo IMEI do aparelho (Admin → Dispositivos → Novo)
- [ ] Response retorna o dispositivo com `traccarId` preenchido (não `null`)
- [ ] Campo `posicao.latitude` e `posicao.longitude` têm valores reais
- [ ] Campo `posicao.velocidade` está em **km/h** (valor razoável — não em knots)
- [ ] Campo `status` é `"online"`

### 3.3 — Histórico de posições *(Postman → produção)*

```
GET https://api.agillock.com.br/api/rastreamento/dispositivos/ID_AGILLOCK/historico
Authorization: Bearer <token_admin>
```

- [ ] Retorna `200` com `{ dispositivo, total, posicoes }`
- [ ] `total` maior que 0
- [ ] Posições têm `latitude`, `longitude`, `velocidade`, `fixTime`

### 3.4 — Relatório de viagens *(Postman → produção, após o dispositivo fazer uma viagem)*

> Requer que o dispositivo tenha ligado, se movido e desligado pelo menos uma vez.

```
GET https://api.agillock.com.br/api/rastreamento/dispositivos/ID_AGILLOCK/viagens
Authorization: Bearer <token_admin>
```

- [ ] Retorna array de viagens com `inicio`, `fim`, `distancia` (km), `velocidadeMedia`, `duracao` (minutos)

### 3.5 — Tratamento de erro (Traccar offline) *(no servidor via SSH)*

```bash
docker compose stop traccar
```

```
GET https://api.agillock.com.br/api/rastreamento/posicoes
```

- [ ] Retorna `502` com `{ "error": "Servidor de rastreamento indisponível." }`

```bash
docker compose start traccar
```

- [ ] Rota volta a retornar `200` após o Traccar reiniciar

---

## Fase 4 — WebSocket tempo real *(produção)*

Objetivo: confirmar que atualizações de posição chegam ao frontend em ~1-2 segundos.

### 4.1 — Bridge conectada ao Traccar *(logs do servidor)*

```bash
docker compose logs backend | grep -i "WS Traccar"
```

- [ ] Mostra `[WS Traccar] Conectando...`
- [ ] Mostra `[WS Traccar] Conectado.`
- [ ] Sem erros de autenticação

### 4.2 — Frontend recebe mensagens em tempo real *(browser em produção)*

Abrir o console do browser na tela do AgilLock e executar:

```javascript
const token = localStorage.getItem('al_token');
const ws = new WebSocket(`wss://api.agillock.com.br/ws/rastreamento?token=${token}`);
ws.onmessage = (e) => console.log('WS:', JSON.parse(e.data));
ws.onopen = () => console.log('Conectado!');
```

- [ ] Console mostra `Conectado!`
- [ ] Ao mover o dispositivo, mensagem com `positions` aparece em ~1-2 segundos
- [ ] Campos `velocidade`, `latitude`, `longitude`, `curso` presentes

### 4.3 — Reconexão automática *(no servidor via SSH)*

```bash
docker compose restart traccar
```

- [ ] Logs do backend mostram `[WS Traccar] Conexão fechada. Reconectando em 5s...`
- [ ] Após ~5-10s, `[WS Traccar] Conectado.` aparece
- [ ] Frontend volta a receber mensagens sem precisar recarregar a página

---

## Fase 5 — Frontend tela rastreamento.html *(produção)*

Objetivo: validar a tela de mapa com dados reais do dispositivo.

### 5.1 — Carregamento inicial

- [ ] Tela abre sem erros no console do browser
- [ ] Mapa renderiza com tiles OpenStreetMap
- [ ] Badge `● Tempo real ativo` (verde) aparece no canto inferior direito
- [ ] Sidebar mostra o veículo com status correto
- [ ] Marcador aparece na posição real do dispositivo

### 5.2 — Marcador e popup

- [ ] Cor do marcador correta: azul (em movimento), verde (parado online), cinza (offline)
- [ ] Clicar no marcador abre popup com nome, placa, status, velocidade, cliente
- [ ] Triângulo do marcador aponta na direção de movimento (`curso`)

### 5.3 — Atualização em tempo real

- [ ] Mover o dispositivo → marcador se move no mapa sem recarregar a página
- [ ] Velocidade na sidebar atualiza em tempo real
- [ ] Status muda de verde (parado) para azul (em movimento) conforme o veículo anda

### 5.4 — Sidebar e filtro

- [ ] Campo de busca filtra por nome/placa em tempo real
- [ ] Clicar na sidebar centraliza o mapa no veículo e abre popup
- [ ] Veículos em movimento aparecem no topo da lista

### 5.5 — Resiliência (Traccar offline) *(no servidor via SSH)*

```bash
docker compose stop traccar
```

- [ ] Badge muda para `● Reconectando...`
- [ ] Nenhum erro crítico no console (sem tela em branco)

```bash
docker compose start traccar
```

- [ ] Badge volta para `● Tempo real ativo` automaticamente

---

## Fase 6 — Estabilidade e filtros *(produção — após uso contínuo)*

Objetivo: garantir que o sistema está estável com filtros ativos após uso real prolongado.

### 6.1 — Verificar filtros ativos no banco *(após ~30min de uso)*

```bash
docker compose exec postgres psql -U agillock_user -d traccar -c "
SELECT COUNT(*) as total,
       COUNT(*) FILTER (WHERE valid = false) as invalidas,
       COUNT(*) FILTER (WHERE latitude = 0 AND longitude = 0) as zeradas
FROM tc_positions;"
```

- [ ] `invalidas` = 0 (filtro descartou posições com `valid=false`)
- [ ] `zeradas` = 0 (filtro descartou coordenadas 0,0)

### 6.2 — Funcionamento contínuo por 30 minutos

- [ ] Dispositivo funcionando 30min sem erros nos logs do Traccar
- [ ] Backend sem erros relacionados ao WebSocket bridge
- [ ] `docker stats` mostra memória estável (sem crescimento contínuo)

```bash
docker stats --no-stream
```

---

## Registro de problemas

| Data | Fase | Problema | Solução |
|---|---|---|---|
| | | | |
