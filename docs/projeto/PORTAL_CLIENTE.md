# Portal do Cliente - Estado Atual e Base para App Mobile

Atualizado em: 2026-05-03

O portal do cliente web está implementado e serve como base funcional para o futuro app React Native Expo.

## Visão geral

```text
Login unificado
  POST /api/auth/login
    -> ADMIN/COLABORADOR/VENDEDOR: áreas internas
    -> CLIENTE: portal do cliente

Portal cliente
  AgillockSite/cliente/rastreamento.html
  AgillockSite/cliente/pagamentos.html
```

O cliente usa JWT próprio, separado dos usuários internos.

Payload:

```json
{
  "sub": "clienteLoginId",
  "clienteId": "uuid",
  "role": "CLIENTE",
  "tipo": "responsavel"
}
```

`tipo` pode ser:

| Tipo | Acesso |
|---|---|
| `responsavel` | Rastreamento, boletos, foto, geocercas, notificações e manutenções |
| `vinculado` | Rastreamento de dispositivos vinculados, conforme regras do backend |

## Login do cliente

O mesmo endpoint atende todos os perfis:

```text
POST /api/auth/login
```

Body:

```json
{ "email": "cliente@email.com", "senha": "SenhaSegura123" }
```

Resposta:

```json
{
  "token": "jwt",
  "user": {
    "id": "clienteLoginId",
    "nome": "João Silva",
    "email": "cliente@email.com",
    "role": "CLIENTE",
    "tipo": "responsavel"
  }
}
```

`POST /api/auth/cliente` permanece como alias de compatibilidade.

## Gestão do login pelo admin/colaborador

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/clientes/:id/login` | Consulta login do cliente |
| POST | `/api/clientes/:id/login` | Cria login |
| PUT | `/api/clientes/:id/login` | Altera email/senha |
| PATCH | `/api/clientes/:id/login/status` | Ativa/inativa |
| DELETE | `/api/clientes/:id/login` | Remove login |

Permissões granulares:

```text
podeCriarLoginCliente
podeEditarLoginCliente
podeInativarLoginCliente
podeExcluirLoginCliente
```

## Perfil e Avatar (App Mobile)

Estes endpoints foram criados especificamente para suportar o aplicativo mobile, permitindo o gerenciamento da conta e o upload de foto do usuário.

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/cliente/perfil` | Retorna dados do cliente, `avatarUrl` e lista os veículos divididos entre faturamento e vinculados |
| POST | `/api/cliente/perfil/avatar` | Upload de foto de perfil (multipart/form-data). Retorna a nova `avatarUrl`. |

O upload salva a imagem em `/uploads/cliente-avatar` e apaga automaticamente a foto antiga do servidor.

## Rastreamento

Rotas principais:

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/cliente/rastreamento/status-acesso` | Verifica bloqueio |
| GET | `/api/cliente/rastreamento/posicoes` | Snapshot dos dispositivos |
| GET | `/api/cliente/rastreamento/prefs` | Preferências do usuário |
| POST | `/api/cliente/rastreamento/prefs` | Substitui preferências |
| POST | `/api/cliente/rastreamento/prefs/merge` | Mescla preferências |
| GET | `/api/cliente/rastreamento/geocode/reverse` | Reverse geocode |

O snapshot retorna apenas dispositivos:

- Em que `Dispositivo.clienteId` é o cliente do token.
- Ou em que existe vínculo em `DispositivoCliente`.

Campos importantes para o app:

```json
{
  "dispositivoId": "uuid",
  "nome": "Tracker Hilux",
  "placa": "ABC-1234",
  "categoria": "car",
  "imagemUrlCliente": "/uploads/cliente/foto.webp",
  "marca": "Toyota",
  "modeloVeiculo": "Hilux",
  "cor": "Prata",
  "limiteVelocidade": 100,
  "podeGerenciarManutencao": true,
  "cliente": { "id": "uuid", "nome": "João Silva" },
  "traccarId": 1,
  "status": "online",
  "lastUpdate": "2026-05-03T12:00:00.000Z",
  "posicao": {}
}
```

## Bloqueio por inadimplência

Regra:

```text
bloqueado = existe boleto status ATRASADO
            e vencimento < hoje - 10 dias
            e pertence ao cliente do token
```

Consulta:

```text
GET /api/cliente/rastreamento/status-acesso
```

Resposta:

```json
{ "bloqueado": false }
```

ou:

```json
{ "bloqueado": true, "diasAtraso": 15 }
```

Enquanto bloqueado, rotas de rastreamento retornam:

```json
{ "error": "acesso_bloqueado" }
```

com HTTP `403`.

## Histórico e relatórios

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/cliente/rastreamento/dispositivos/:id/historico` | Histórico de posições |
| GET | `/api/cliente/rastreamento/dispositivos/:id/viagens` | Viagens |
| GET | `/api/cliente/rastreamento/dispositivos/:id/paradas` | Paradas |
| GET | `/api/cliente/rastreamento/dispositivos/:id/eventos` | Eventos |
| GET | `/api/cliente/rastreamento/dispositivos/:id/resumo` | Resumo |
| GET | `/api/cliente/rastreamento/relatorios/batch/historico` | Histórico em lote |
| GET | `/api/cliente/rastreamento/relatorios/batch/viagens` | Viagens em lote |
| GET | `/api/cliente/rastreamento/relatorios/batch/paradas` | Paradas em lote |
| GET | `/api/cliente/rastreamento/relatorios/batch/eventos` | Eventos em lote |
| GET | `/api/cliente/rastreamento/relatorios/batch/resumo` | Resumo em lote |
| GET | `/api/cliente/rastreamento/dispositivos/:id/exportar` | Exportação individual |
| GET | `/api/cliente/rastreamento/relatorios/exportar` | Exportação em lote |

Filtros de período usam `from` e `to` em ISO 8601.

Nas rotas em lote do cliente, `deviceId` é o `dispositivoId` local; o backend converte para Traccar.

## Foto do veículo

| Método | Rota | Descrição |
|---|---|---|
| POST | `/api/cliente/dispositivos/:dispositivoId/foto` | Upload |
| DELETE | `/api/cliente/dispositivos/:dispositivoId/foto` | Remoção |

Upload:

- `multipart/form-data`
- Campo: `foto`
- Tipos aceitos: JPG, PNG, WEBP
- Limite atual do backend: 10 MB

Resposta:

```json
{ "imagemUrlCliente": "/uploads/cliente/arquivo.webp" }
```

`imagemUrlCliente` é separada de `imagemUrl`, que é a imagem administrativa do dispositivo.

## Comandos

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/cliente/dispositivos/:dispositivoId/tipos-comandos` | Tipos suportados |
| POST | `/api/cliente/dispositivos/:dispositivoId/comandos` | Envia comando |

Body:

```json
{ "tipo": "engineStop", "atributos": {} }
```

O app deve exigir confirmação explícita para comandos sensíveis, principalmente `engineStop` e `engineResume`.

## Pagamentos

Disponível para cliente responsável.

```text
GET /api/cliente/boletos
```

Filtros:

```text
status=PENDENTE|PAGO|ATRASADO|CANCELADO|REEMBOLSADO
dataVencDe=YYYY-MM-DD
dataVencAte=YYYY-MM-DD
placaId=uuid
```

Resposta inclui valor, vencimento, status, placa/dispositivo quando aplicável e `linkBoleto`.

## Geocercas

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/cliente/rastreamento/cercas` | Cercas para exibição no mapa |
| GET | `/api/cliente/rastreamento/dispositivos/:dispositivoId/cercas` | Cercas por dispositivo |
| POST | `/api/cliente/rastreamento/cercas` | Cria cerca simples |
| DELETE | `/api/cliente/rastreamento/cercas/:id` | Remove cerca simples |
| GET | `/api/cliente/rastreamento/geocercas` | Lista gerencial |
| GET | `/api/cliente/rastreamento/geocercas/:id` | Detalhe |
| POST | `/api/cliente/rastreamento/geocercas` | Cria |
| PUT | `/api/cliente/rastreamento/geocercas/:id` | Edita |
| DELETE | `/api/cliente/rastreamento/geocercas/:id` | Exclui |

O cliente só gerencia geocercas próprias (`origemTipo = "CLIENTE"`). Geocercas do admin aparecem quando `visivelCliente = true`.

## Notificações

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/cliente/notificacoes/preferencias/:dispositivoId` | Preferências |
| POST | `/api/cliente/notificacoes/preferencias` | Salva preferência |
| GET | `/api/cliente/notificacoes/app-tokens` | Lista tokens Expo ativos |
| POST | `/api/cliente/notificacoes/app-tokens` | Registra token Expo do aparelho |
| DELETE | `/api/cliente/notificacoes/app-tokens` | Desativa token Expo |
| PATCH | `/api/cliente/notificacoes/km-troca-oleo/:dispositivoId` | Configura troca de óleo |
| POST | `/api/cliente/notificacoes/confirmar-troca-oleo/:dispositivoId` | Confirma troca |
| GET | `/api/cliente/notificacoes/km-config/:dispositivoId` | Configurações de km |
| GET | `/api/cliente/notificacoes/eventos` | Eventos gerados |

Canais:

```text
web, app, email
```

Eventos:

```text
ignitionOn, ignitionOff, geofenceEnter, geofenceExit,
overspeed, powerCut, kmExcedida, kmReduzida, trocaOleo,
deviceLocked, deviceUnlocked, boletoVencendoHoje, boletoAtrasado,
pagamentoRecebido
```

O app usa Expo Push Notifications sem Firebase. Após login, deve obter o token Expo via `expo-notifications` e chamar:

```text
POST /api/cliente/notificacoes/app-tokens
```

O backend envia:

- Notificação no dia do vencimento do boleto às 09:00.
- Notificação diária às 09:00 para boletos em atraso enquanto permanecerem em aberto, lembrando de manter o pagamento em dia para continuar com acesso ao monitoramento.
- Notificação de pagamento recebido quando o boleto for marcado como pago.

## Manutenções

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/cliente/manutencoes/registros` | Lista registros |
| POST | `/api/cliente/manutencoes/registros` | Cria registro |
| PUT | `/api/cliente/manutencoes/registros/:id` | Edita registro |
| DELETE | `/api/cliente/manutencoes/registros/:id` | Remove registro |
| GET | `/api/cliente/manutencoes/recorrencias` | Lista recorrências |
| POST | `/api/cliente/manutencoes/recorrencias` | Cria recorrência |
| PUT | `/api/cliente/manutencoes/recorrencias/:id` | Edita recorrência |
| POST | `/api/cliente/manutencoes/recorrencias/:id/feito` | Marca como feita |
| DELETE | `/api/cliente/manutencoes/recorrencias/:id` | Remove recorrência |

## WebSocket no app

Endpoint:

```text
wss://api.agillock.com.br/ws/rastreamento
```

Fluxo recomendado:

1. Fazer login e salvar token.
2. Chamar `/cliente/rastreamento/status-acesso`.
3. Chamar `/cliente/rastreamento/posicoes`.
4. Montar mapa `traccarId -> dispositivoId`.
5. Abrir WebSocket.
6. Aplicar apenas mensagens cujo `deviceId` exista no mapa local.
7. Recarregar snapshot após reconexão ou mudança de conta.

Mensagem de posição usa `deviceId` como `traccarId`.

## Observações para o plano mobile

- O app não precisa replicar a estrutura HTML do portal; deve reaproveitar os contratos.
- Telas naturais para o app: login, mapa ao vivo, detalhe do veículo, histórico, relatórios, comandos, notificações, geocercas, manutenções, pagamentos e perfil.
- Push notification usa Expo Push API. O app deve registrar o token Expo em `/api/cliente/notificacoes/app-tokens` após login e removê-lo no logout.
