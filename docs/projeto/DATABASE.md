# Banco de Dados - AgilLock Rastreamento

Atualizado em: 2026-05-03

ORM: Prisma
Banco: PostgreSQL
Schema fonte: `backend/prisma/schema.prisma`

## Visão geral

```text
User
  -> Cliente
      -> ClienteLogin
      -> Placa
      -> Dispositivo
          -> DispositivoCliente
          -> MotoristaDispositivo
          -> PreferenciaNotificacao
          -> EventoNotificacao
          -> ManutencaoRegistro
          -> ManutencaoRecorrencia
          -> GeocercaDispositivo
      -> Carne
          -> Boleto
              -> BoletoPlaca
              -> BoletoDispositivo
              -> ComissaoVendedor
      -> Contrato
      -> Geocerca
```

## Enums

```prisma
enum Role {
  ADMIN
  COLABORADOR
  VENDEDOR
}

enum StatusCliente {
  ATIVO
  INATIVO
}

enum TipoCarne {
  INDIVIDUAL
  UNIFICADO
}

enum StatusBoleto {
  PENDENTE
  PAGO
  ATRASADO
  CANCELADO
  REEMBOLSADO
}
```

## Usuários internos

`User` representa admin, colaborador e vendedor.

Campos importantes:

- `role`
- `ativo`
- permissões granulares de cliente, placa, dispositivo, cobrança, contrato e monitoramento
- `podeAcessarMonitoramento`
- permissões de login do cliente

Permissões de colaborador:

```text
podeExcluirCliente, podeEditarCliente, podeInativarCliente,
podeExcluirPlaca, podeInativarPlaca,
podeExcluirDispositivo, podeInativarDispositivo,
podeCriarDispositivo, podeEditarDispositivo, podeDesvincularDispositivo,
podeBaixaManual, podeCancelarCarne, podeAlterarVencimento,
podeCriarContrato, podeEditarContrato, podeExcluirContrato,
podeAcessarMonitoramento,
podeCriarLoginCliente, podeEditarLoginCliente,
podeInativarLoginCliente, podeExcluirLoginCliente
```

`AdminPreferencia` guarda preferências JSON por usuário admin/colaborador.

## Cliente e login do cliente

`Cliente` guarda dados cadastrais, endereço, tipo pessoa, origem, vendedor responsável, contratos, placas, dispositivos e login.

`ClienteLogin` é separado de `User` e usado pelo portal/app.

Campos:

```text
id, clienteId, email, senhaHash, ativo, prefs
```

O JWT de cliente usa `ClienteLogin.id` como `sub` e `Cliente.id` como `clienteId`.

## Placas

`Placa` mantém compatibilidade com cobranças por placa.

Campos:

```text
placa, descricao, ativo, valorPadrao, clienteId, vendedorId
```

`vendedorId` é o dono comercial da placa para cálculo de comissão.

## Dispositivos

`Dispositivo` é o cadastro principal do rastreamento.

Campos de integração:

```text
traccarId
identificador
```

`identificador` é o IMEI e chave de vínculo com `tc_devices.uniqueid` no Traccar.

Campos do rastreador:

```text
modeloRastreador, telefoneRastreador, iccid, operadora
```

Campos do veículo:

```text
placa, marca, modeloVeiculo, cor, ano, renavam, chassi,
combustivel, localInstalacao, instalador
```

Campos de medidores do sistema:

```text
ignorarOdometro
odometroSistemaMetros
horimetroSistemaSegundos
telemetriaUltimaPosicaoEm
telemetriaUltimaLatitude
telemetriaUltimaLongitude
telemetriaUltimaIgnicao
```

Imagens:

```text
imagemUrl         -> imagem cadastrada pelo admin
imagemUrlCliente  -> imagem enviada pelo cliente
```

Vínculos:

- `clienteId`: cliente principal/faturamento.
- `DispositivoCliente`: clientes vinculados que também podem visualizar.
- `MotoristaDispositivo`: motoristas vinculados.

## Motoristas

`Motorista` representa condutor e pode ser sincronizado com o Traccar como driver.

Campos:

```text
nome, identificador, traccarId, cnh, telefone, ativo
```

Relação N:N com dispositivos via `MotoristaDispositivo`.

## Cobranças

`Carne` agrupa boletos.

Campos:

```text
tipo, efiCarneId, efiCarneLink, valorTotal, numeroParcelas,
clienteId, geradoPorId, vendedorId
```

`Boleto` representa parcela/cobrança.

Campos:

```text
numeroParcela, valor, vencimento, status,
dataPagamento, valorPago, efiChargeId, linkBoleto,
placaId, dispositivoId
```

Relações para unificados:

- `BoletoPlaca`: valor individual por placa.
- `BoletoDispositivo`: valor individual por dispositivo.

## Comissões

`ComissaoVendedor` é gerada quando boleto é marcado como pago.

Campos:

```text
valorReferencia, percentualAplicado, valorComissao,
pago, dataPagamento, vendedorId, boletoId
```

`PagamentoComissao` registra pagamento mensal ao vendedor:

```text
vendedorId, mes, valor, pago, comprovante, comprovanteMime
```

Constraint:

```prisma
@@unique([vendedorId, mes])
```

## Configurações

`Configuracoes` é singleton com `id = "1"`.

Campos:

```text
percentualMenor, percentualMaior, valorReferencia,
multaPercentual, jurosDiarios,
representanteNome, representanteEmail, representanteTelefone, representanteCpf
```

## Notificações

`PreferenciaNotificacao`

```text
clienteLoginId, dispositivoId, tipoEvento,
web, app, email,
overspeedLimit, kmMaximo30Dias, diaRenovacaoMes,
kmMinimo7Dias, diaSemanaRenovacao, kmTrocaOleo
```

Constraint:

```prisma
@@unique([clienteLoginId, dispositivoId, tipoEvento])
```

`EstadoKmNotificacao` controla base e repetição de alertas por km.

`EventoNotificacao` guarda eventos gerados:

```text
tipoEvento, mensagem, latitude, longitude, endereco,
velocidade, lido, createdAt
```

## Manutenções

`ManutencaoRegistro` guarda histórico executado.

Campos:

```text
dispositivoId, clienteLoginId, criadoPorAdminId,
titulo, tipo, descricao, dataRealizacao, kmRealizacao,
custo, oficina, notas, fotos, origem
```

`ManutencaoRecorrencia` guarda planos recorrentes por km.

Campos:

```text
dispositivoId, clienteLoginId, criadoPorAdminId,
titulo, descricao, intervaloKm, kmBase,
alerta50Enviado, alerta25Enviado, alerta0Enviado,
ultimaAlertaPostDueKm, ativa, origem
```

## Geocercas

`Geocerca` espelha geocercas do Traccar e guarda metadados locais.

Campos:

```text
traccarId, nome, descricao, area, tipo,
origemTipo, clienteId, visivelCliente,
notificarCliente, sistemasNotif, dataInicio, ativa
```

`origemTipo`:

```text
ADMIN
CLIENTE
```

`GeocercaDispositivo` vincula geocerca a dispositivo local.

## Contratos

`Contrato` guarda HTML renderizado, status, Clicksign e signatários.

Campos relevantes:

```text
tipo, clienteId, fiadores, testemunhas, htmlConteudo,
metodoAutenticacao, status, clicksignEnvelopeId,
clicksignDocumentoId, signatarios, criadoPorId, assinadoEm
```

## Migrations recentes importantes

| Migration | Conteúdo |
|---|---|
| `20260417000000_portal_cliente` | Portal do cliente |
| `20260421164747_add_motorista` | Motoristas |
| `20260422012240_add_motorista_traccar_fields` | Campos Traccar de motorista |
| `20260422014208_many_to_many_motorista_dispositivo` | Vínculo motorista/dispositivo |
| `20260422040000_add_dispositivo_medidores_sistema` | Medidores do sistema |
| `20260426033043_add_notification_tables` | Notificações |
| `20260426200000_add_km_notifications` | Alertas por km |
| `20260426210000_add_endereco_evento_notificacao` | Endereço em evento |
| `20260426230000_add_ultima_notificacao_km` | Controle de repetição de km |
| `20260427000000_add_admin_preferencia` | Preferências admin |
| `20260427235432_add_prefs_field` | Preferências do login cliente |
| `20260429034038_add_manutencoes` | Manutenções |
| `20260430011545_add_geocerca` | Geocercas |
| `20260502000000_add_colaborador_monitoramento_permission` | Permissão de monitoramento |

## Observações operacionais

- Em desenvolvimento, usar `npx prisma migrate dev`.
- Em produção, usar `npx prisma migrate deploy`.
- O schema atual não define `url` diretamente no datasource; a conexão vem da configuração Prisma/ambiente.
- O banco Traccar é independente; o vínculo operacional com AgilLock é por IMEI e `traccarId`.
