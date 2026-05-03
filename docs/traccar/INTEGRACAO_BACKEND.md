# Integração Traccar - Backend AgilLock

Atualizado em: 2026-05-03

Este documento descreve a integração real implementada no backend Node.js/Express.

Arquivos principais:

| Arquivo | Responsabilidade |
|---|---|
| `backend/src/services/traccar.service.ts` | Cliente REST do Traccar, tipos e normalização de atributos |
| `backend/src/services/traccar.ws.ts` | Bridge WebSocket Traccar -> clientes conectados |
| `backend/src/routes/rastreamento.routes.ts` | API admin/colaborador |
| `backend/src/routes/cliente-portal.routes.ts` | API de rastreamento do cliente/app |
| `backend/src/services/medidores.service.ts` | Odômetro/horímetro do sistema e decoração de posições |
| `backend/src/services/notification.service.ts` | Notificações geradas por eventos, posição e km |
| `backend/src/routes/dispositivos.routes.ts` | Sincronização de dispositivos com Traccar |
| `backend/src/routes/motoristas.routes.ts` | Motoristas/drivers e vínculos |

## Variáveis de ambiente

```env
TRACCAR_URL=http://traccar:8082
TRACCAR_USER=admin@example.com
TRACCAR_PASSWORD=senha
GOOGLE_MAPS_GEOCODING_API_KEY=opcional
GOOGLE_MAPS_JS_API_KEY=opcional
```

Se não houver chave Google, o backend usa Nominatim como fallback para reverse geocode.

## Fluxo REST

1. Frontend/app chama API AgilLock com JWT.
2. Backend valida role e permissão.
3. Backend busca dispositivo local no Prisma.
4. Backend resolve o dispositivo no Traccar por `Dispositivo.identificador = Device.uniqueId`.
5. Backend chama relatórios/posições/comandos no Traccar.
6. Backend normaliza unidades, junta dados locais e responde ao cliente.

## Fluxo WebSocket

```text
Traccar /api/socket
  -> backend traccar.ws.ts
  -> /ws/rastreamento
  -> site/app conectados
```

O backend:

- Obtém `JSESSIONID` em `POST /api/session`.
- Abre conexão permanente com `ws(s)://<traccar>/api/socket`.
- Reconecta automaticamente quando a conexão cai.
- Mantém cache `traccarId -> IMEI`.
- Normaliza posições e eventos.
- Atualiza medidores do sistema.
- Gera notificações assíncronas.
- Retransmite payloads para clientes conectados.

Observação: a conexão frontend atual é aceita no path `/ws/rastreamento`. O app deve filtrar mensagens pelo conjunto de `traccarId` recebido no snapshot do cliente.

## REST client do Traccar

O serviço `traccar.service.ts` usa `fetch` com Basic Auth para:

- Dispositivos: listar, buscar por IMEI, criar, editar, excluir, atualizar acumuladores.
- Posições: últimas posições e rota/histórico.
- Relatórios: trips, stops, events, summary e exportação XLSX.
- Comandos: tipos e envio.
- Geocercas: CRUD e permissões de vínculo.
- Motoristas: CRUD e permissões de vínculo.
- Logs e sessão WebSocket.

## Normalização de telemetria

`normalizeAttributes` converte `attributes` do Traccar para campos estáveis:

```text
ignicao, emMovimento, alarme, sinal, satelites, tensao,
bateria_tensao, bateria_nivel, carregando, odometro,
distancia_segmento, horas_motor, combustivel, bloqueado,
entrada_digital, saida_digital, motorista_id
```

Isso evita que site e app dependam de nomes específicos de cada protocolo.

## Medidores do sistema

Quando `Dispositivo.ignorarOdometro = true`, o backend usa os medidores calculados pelo AgilLock em vez de confiar totalmente no odômetro nativo do rastreador.

Campos persistidos:

```text
odometroSistemaMetros
horimetroSistemaSegundos
telemetriaUltimaPosicaoEm
telemetriaUltimaLatitude
telemetriaUltimaLongitude
telemetriaUltimaIgnicao
```

Esses campos são aplicados em snapshots, histórico, viagens, paradas e resumo.

## Geocercas

Cada geocerca existe em dois lugares:

- Traccar: área real usada em eventos/relatórios.
- AgilLock: metadados, origem, visibilidade para cliente, notificações e vínculos locais.

Campos locais relevantes:

```text
traccarId, nome, descricao, area, tipo, origemTipo,
clienteId, visivelCliente, notificarCliente, sistemasNotif,
dataInicio, ativa
```

Vínculos com dispositivos são espelhados via `GeocercaDispositivo` e `/api/permissions` do Traccar.

## Eventos e notificações

O WebSocket processa:

- Eventos nativos do Traccar.
- Eventos sintéticos de entrada/saída de geocerca quando necessário.
- Mudanças detectadas por posição, como ignição e velocidade.
- Alertas por km e troca de óleo.

As notificações são persistidas em `EventoNotificacao` e respeitam `PreferenciaNotificacao`.

## Rotas expostas pelo backend

Ver contratos detalhados em:

- `docs/traccar/API.md`
- `docs/projeto/API.md`

Resumo:

| Prefixo | Público |
|---|---|
| `/api/rastreamento/*` | Admin/colaborador |
| `/api/cliente/rastreamento/*` | Cliente/app |
| `/api/cliente/notificacoes/*` | Cliente/app |
| `/api/notificacoes-admin/*` | Admin/colaborador |
| `/api/cliente/manutencoes/*` | Cliente/app |
| `/api/manutencoes-admin/*` | Admin/colaborador |
| `/ws/rastreamento` | Tempo real |

## Cuidados operacionais

- Se Traccar cair, REST retorna `502` nas rotas que dependem dele.
- WebSocket tenta reconectar sozinho.
- Cadastro de dispositivo deve tratar falha de sincronização sem corromper o cadastro local.
- Logs podem vir do arquivo `/opt/traccar/logs/tracker-server.log` ou de `/api/server/log`.
- O app mobile deve considerar WebSocket como stream incremental e manter o snapshot REST como fonte inicial de verdade.
