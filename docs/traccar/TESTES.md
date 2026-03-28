# Plano de Testes — Integração Traccar

> Execute os testes na ordem apresentada. Cada fase depende da anterior.
> Marque cada item com ✅ ao concluir. Registre problemas encontrados abaixo de cada bloco.

---

## Fase 1 — Conectividade (Traccar isolado)

Objetivo: garantir que o Traccar está rodando e o dispositivo consegue se conectar, **antes de escrever qualquer linha de código no backend**.

### 1.1 — Traccar Web UI acessível

- [✅] `http://localhost:8082` abre a tela de login do Traccar
- [✅] Login com `admin@agillock.com.br` / `AdminTraccar@dev` funciona
- [✅] Menu lateral exibe: Devices, Reports, Settings

### 1.2 — Banco de dados criado corretamente

- [✅] No DBeaver/psql, conectar em `localhost:5433` com `agillock_user / dev_password`
- [✅] Banco `traccar` existe e contém as tabelas: `tc_devices`, `tc_positions`, `tc_users`, `tc_events`

```sql
-- Verificar tabelas criadas
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_catalog = 'traccar'
ORDER BY table_name;
```

Esperado: ~20 tabelas listadas.

### 1.3 — Cadastro do dispositivo de teste

- [ ] No Traccar Web UI: Devices → `+`
  - Name: `Teste GT06`
  - Identifier: IMEI do aparelho (15 dígitos)
- [ ] Dispositivo aparece na lista com status `Unknown` (cinza)

### 1.4 — Dispositivo GT06 se conecta ao Traccar

Antes de enviar os SMS, descobrir o IP local da máquina:
```bash
# Windows — procurar "Endereço IPv4" da rede Wi-Fi ou Ethernet
ipconfig
# Exemplo de resultado: 192.168.1.10
```

Enviar SMS para o número do chip do aparelho:
```
APN,NOME_DA_OPERADORA#
SERVER,0,192.168.1.10,5023,0#
RESET#
```

- [ ] Após ~2 minutos, dispositivo aparece como `Online` (verde) no Traccar Web UI
- [ ] Posição aparece no mapa do Traccar Web UI (pode ser em área aberta para garantir fix GPS)
- [ ] Logs do Traccar mostram conexão:
  ```bash
  docker compose -f docker-compose.dev.yml logs traccar | grep -i "gt06\|connected\|position"
  ```

**Problemas comuns nesta fase:**
- Status permanece Unknown → APN errado ou porta 5023 bloqueada (verificar firewall do Windows)
- Posição não aparece → dispositivo sem fix GPS (testar em área aberta)

---

## Fase 2 — API REST do Traccar

Objetivo: confirmar que a API do Traccar responde corretamente antes de integrar ao backend.

> Usar Postman, Insomnia ou `curl`. Basic Auth: `admin@agillock.com.br:AdminTraccar@dev`

### 2.1 — Listar dispositivos

```
GET http://localhost:8082/api/devices
Authorization: Basic YWRtaW5AYWdpbGxvY2suY29tLmJyOkFkbWluVHJhY2NhckBkZXY=
```

- [ ] Retorna array com o dispositivo cadastrado
- [ ] Campo `status` é `"online"`
- [ ] Campo `uniqueId` bate com o IMEI cadastrado

### 2.2 — Última posição

```
GET http://localhost:8082/api/positions?deviceId=ID_DO_DISPOSITIVO
```

- [ ] Retorna array com pelo menos uma posição
- [ ] Campos `latitude` e `longitude` têm valores reais (não `0.0`)
- [ ] Campo `valid` é `true`
- [ ] Campo `speed` tem valor numérico (mesmo que 0 se parado)
- [ ] `attributes.ignition` presente e é `true` ou `false`

### 2.3 — Histórico de posições

```
GET http://localhost:8082/api/positions?deviceId=ID&from=2026-03-28T00:00:00Z&to=2026-03-28T23:59:59Z
```

- [ ] Retorna array de posições do período
- [ ] Posições em ordem cronológica

### 2.4 — WebSocket do Traccar (opcional, diagnóstico)

Usar o próprio browser para testar: abrir o console em `http://localhost:8082` após login e verificar que o WebSocket `/api/socket` está ativo na aba Network.

- [ ] Na aba Network → WS, conexão `api/socket` aparece com status 101 (Switching Protocols)
- [ ] Mensagens chegam quando o dispositivo se move

---

## Fase 3 — Backend Node.js

Objetivo: confirmar que o backend AgilLock consome o Traccar corretamente.

> Pré-requisito: Etapa 3 do ROADMAP implementada (serviço + rotas criados).

### 3.1 — Serviço `traccar.service.ts` — conexão básica

- [ ] `GET http://localhost:3000/api/rastreamento/posicoes` retorna `200`
- [ ] Response é um array (mesmo que vazio se o dispositivo não estiver no banco AgilLock)
- [ ] Sem erros `502` (indicaria que o backend não consegue chegar no Traccar)

### 3.2 — Dispositivo sincronizado entre AgilLock e Traccar

- [ ] Cadastrar um `Dispositivo` no AgilLock com o mesmo IMEI do aparelho cadastrado no Traccar
  - Ir em Admin → Dispositivos → Novo
  - Preencher `identificador` com o IMEI
- [ ] `GET /api/rastreamento/posicoes` retorna o dispositivo com `traccarId` preenchido (não `null`)
- [ ] Campo `posicao` no response tem `latitude` e `longitude` válidos
- [ ] Campo `velocidade` está em km/h (não em knots — verificar se é valor razoável)
- [ ] Campo `status` é `"online"`

### 3.3 — Histórico de posições via backend

```
GET http://localhost:3000/api/rastreamento/dispositivos/ID_AGILLOCK/historico
Authorization: Bearer <token>
```

- [ ] Retorna `200` com objeto `{ dispositivo, total, posicoes }`
- [ ] `total` é maior que 0
- [ ] Posições têm `latitude`, `longitude`, `velocidade`, `fixTime`

### 3.4 — Relatório de viagens

> Requer que o dispositivo tenha feito pelo menos uma viagem (ligou, andou, desligou).

```
GET http://localhost:3000/api/rastreamento/dispositivos/ID_AGILLOCK/viagens
```

- [ ] Retorna array de viagens
- [ ] Cada viagem tem `inicio`, `fim`, `distancia` (em km), `velocidadeMedia`, `duracao` (em minutos)

### 3.5 — Tratamento de erro (Traccar offline)

- [ ] Parar o container Traccar: `docker compose -f docker-compose.dev.yml stop traccar`
- [ ] `GET /api/rastreamento/posicoes` retorna `502` com `{ "error": "Servidor de rastreamento indisponível." }`
- [ ] Subir novamente: `docker compose -f docker-compose.dev.yml start traccar`
- [ ] Rota volta a funcionar normalmente

---

## Fase 4 — WebSocket (tempo real)

Objetivo: confirmar que atualizações de posição chegam ao frontend em tempo real via WebSocket.

### 4.1 — WebSocket bridge conectado

- [ ] Ao subir o backend, logs mostram:
  ```
  [WS Traccar] Conectando...
  [WS Traccar] Conectado.
  ```
- [ ] Sem mensagens de erro de autenticação

### 4.2 — Cliente frontend recebe mensagens

Teste rápido no console do browser (com token válido):

```javascript
const token = localStorage.getItem('al_token');
const ws = new WebSocket(`ws://localhost:3000/ws/rastreamento?token=${token}`);
ws.onmessage = (e) => console.log('WS recebido:', JSON.parse(e.data));
ws.onopen = () => console.log('WS conectado!');
```

- [ ] Console mostra `WS conectado!`
- [ ] Ao mover o dispositivo, mensagem com `positions` aparece no console em ~1-2 segundos
- [ ] Campos `velocidade` (km/h), `latitude`, `longitude`, `curso` presentes na mensagem

### 4.3 — Reconexão automática

- [ ] Parar o container Traccar por 10s e religar
- [ ] Logs do backend mostram `[WS Traccar] Conexão fechada. Reconectando em 5s...`
- [ ] Após ~5s, `[WS Traccar] Conectado.` aparece nos logs
- [ ] Frontend continua recebendo mensagens após a reconexão

---

## Fase 5 — Frontend (tela rastreamento.html)

Objetivo: validar a tela de mapa com todos os comportamentos esperados.

### 5.1 — Carregamento inicial

- [ ] Tela abre sem erros no console do browser
- [ ] Mapa renderiza corretamente (tiles OpenStreetMap carregam)
- [ ] Badge `● Tempo real ativo` (verde) aparece no canto inferior direito
- [ ] Sidebar mostra o veículo de teste na lista
- [ ] Contador de status (online/offline) está correto

### 5.2 — Marcador no mapa

- [ ] Marcador aparece na posição correta do dispositivo
- [ ] Cor do marcador: azul se em movimento, verde se parado online, cinza se offline
- [ ] Ao clicar no marcador, popup abre com nome, placa, status, velocidade
- [ ] Link "Ver detalhes" no popup está presente

### 5.3 — Atualização em tempo real

- [ ] Mover o dispositivo (ou simular movimento)
- [ ] Marcador se move no mapa **sem recarregar a página**
- [ ] Item na sidebar atualiza velocidade/status em tempo real
- [ ] Rotação do marcador (triângulo) acompanha a direção do veículo (`curso`)

### 5.4 — Sidebar e filtro

- [ ] Digitar parte do nome ou placa no campo de busca → lista filtra em tempo real
- [ ] Clicar em um item da sidebar → mapa centraliza no veículo e abre popup
- [ ] Item fica destacado (fundo azul) após ser clicado
- [ ] Veículos em movimento aparecem no topo da lista

### 5.5 — Veículo sem posição

- [ ] Cadastrar um dispositivo no AgilLock com IMEI que **não existe** no Traccar
- [ ] Dispositivo aparece na sidebar com texto `Sem posição` em laranja
- [ ] Nenhum marcador no mapa para esse dispositivo
- [ ] Não gera erro no console

### 5.6 — Traccar offline (resiliência)

- [ ] Parar o container Traccar
- [ ] Recarregar a tela `rastreamento.html`
- [ ] Badge muda para `● Reconectando...` (amarelo/laranja)
- [ ] Nenhum erro crítico no console (sem tela em branco)
- [ ] Religar o Traccar → badge volta para `● Tempo real ativo` automaticamente

---

## Fase 6 — Ativar filtros e testar comportamento de produção

Objetivo: validar que o sistema se comporta corretamente com os filtros de posição ativos.

### 6.1 — Ativar filtros no `traccar.dev.xml`

Descomentar o bloco de filtros em `backend/traccar/traccar.dev.xml`:

```xml
<entry key='filter.enable'>true</entry>
<entry key='filter.invalid'>true</entry>
<entry key='filter.zero'>true</entry>
<entry key='filter.duplicate'>true</entry>
<entry key='filter.future'>600</entry>
```

Reiniciar o container:
```bash
docker compose -f docker-compose.dev.yml restart traccar
```

### 6.2 — Verificar comportamento

- [ ] Posições com `valid=true` continuam chegando normalmente
- [ ] Posições duplicadas (dispositivo parado por muito tempo) não poluem o banco
- [ ] Nenhuma posição `0.0, 0.0` aparece no banco `tc_positions`

```sql
-- Verificar se existe alguma posição inválida que escapou
SELECT id, deviceid, valid, latitude, longitude, fixtime
FROM tc_positions
WHERE valid = false OR (latitude = 0 AND longitude = 0)
ORDER BY fixtime DESC LIMIT 10;
```

- [ ] Query retorna 0 linhas (todos os inválidos foram filtrados)

### 6.3 — Confirmar que filtros não quebram o fluxo

- [ ] `GET /api/rastreamento/posicoes` continua retornando posições válidas
- [ ] WebSocket continua recebendo atualizações de posição válidas
- [ ] Mapa do frontend atualiza normalmente

---

## Fase 7 — Pré-deploy (validação final antes de ir para produção)

Objetivo: checklist final para garantir que tudo está pronto para o servidor Hostinger.

### 7.1 — Configurações de produção

- [ ] `traccar/traccar.xml` revisado (filtros ativos, senha via `${POSTGRES_PASSWORD}`)
- [ ] `docker-compose.yml` tem o serviço `traccar` adicionado
- [ ] Porta `8082` **não** está exposta no `docker-compose.yml` de produção
- [ ] Porta `5023` está exposta no `docker-compose.yml` de produção
- [ ] Variáveis `TRACCAR_URL`, `TRACCAR_USER`, `TRACCAR_PASSWORD` estão no `.env` do servidor

### 7.2 — Testes de carga mínima

- [ ] Dispositivo funcionando por 30 minutos contínuos sem erros nos logs
- [ ] Banco `traccar` acumulando posições sem crescimento anormal
- [ ] Backend Node.js sem memory leak (monitorar com `docker stats`)

### 7.3 — Simulação de queda e recuperação

- [ ] Reiniciar o container Traccar em "produção simulada" → dispositivo reconecta sozinho
- [ ] Reiniciar o container backend → WebSocket bridge reconecta com o Traccar
- [ ] Frontend detecta reconexão e exibe badge correto

### 7.4 — Firewall do servidor Hostinger

- [ ] Porta `5023` TCP aberta no painel de firewall da Hostinger
- [ ] Porta `8082` **bloqueada** para acesso externo (só Docker interno)
- [ ] Porta `443` aberta para HTTPS (frontend + API)

### 7.5 — Deploy

- [ ] Código enviado para o servidor (git pull / build)
- [ ] Banco `traccar` criado no PostgreSQL de produção
- [ ] `docker compose up -d` sobe todos os serviços incluindo Traccar
- [ ] Dispositivo reconfigurado via SMS apontando para o domínio/IP de produção:
  ```
  SERVER,0,seudominio.com.br,5023,0#
  ```
- [ ] Dispositivo aparece online na Web UI do Traccar em produção
- [ ] Tela `rastreamento.html` funcionando em produção com tempo real

---

## Registro de problemas

> Anotar aqui qualquer problema encontrado durante os testes com descrição e solução.

| Data | Fase | Problema | Solução |
|---|---|---|---|
| | | | |
