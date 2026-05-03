# API REST - AgilLock Rastreamento

Atualizado em: 2026-05-03

Base de produção: `https://api.agillock.com.br/api`
Base local: `http://localhost:3000/api`

Todas as rotas protegidas usam `Authorization: Bearer <token>`.

Perfis reconhecidos:

| Role | Uso |
|---|---|
| `ADMIN` | Gestão completa |
| `COLABORADOR` | Gestão conforme permissões granulares |
| `VENDEDOR` | Carteira, comissões e comprovantes |
| `CLIENTE` | Portal do cliente e futuro app mobile |

## Convenções

- Datas aceitas em filtros: `YYYY-MM-DD` para cobrança e ISO 8601 para rastreamento (`2026-05-03T00:00:00-03:00`).
- IDs do AgilLock são `uuid` ou `cuid` conforme tabela Prisma.
- `traccarId` é inteiro e pertence ao Traccar; `dispositivoId` é o ID local do AgilLock.
- Erros comuns: `400` payload/filtro inválido, `401` token ausente/inválido, `403` role sem permissão, `404` recurso inexistente, `502` serviço externo indisponível.
- Uploads são servidos por `/uploads/...`.

## Health

| Método | Rota | Auth | Descrição |
|---|---|---|---|
| GET | `/health` | Público | Status da API |

Resposta:

```json
{ "status": "ok", "version": "1.0.0", "timestamp": "2026-05-03T12:00:00.000Z" }
```

## Autenticação

| Método | Rota | Auth | Descrição |
|---|---|---|---|
| POST | `/auth/login` | Público | Login unificado de admin, colaborador, vendedor e cliente |
| POST | `/auth/cliente` | Público | Alias compatível para login de cliente |
| GET | `/auth/me` | Autenticado | Dados do usuário logado |
| PATCH | `/auth/change-password` | Autenticado | Alterar senha do usuário logado |

`POST /auth/login`

```json
{ "email": "usuario@email.com", "senha": "Senha123" }
```

Resposta para usuário interno:

```json
{
  "token": "jwt",
  "user": {
    "id": "uuid",
    "nome": "Admin",
    "email": "admin@email.com",
    "role": "ADMIN"
  }
}
```

Resposta para cliente:

```json
{
  "token": "jwt",
  "user": {
    "id": "clienteLoginId",
    "nome": "Cliente",
    "email": "cliente@email.com",
    "role": "CLIENTE",
    "tipo": "responsavel"
  }
}
```

O JWT de cliente carrega `sub`, `clienteId`, `role: "CLIENTE"` e `tipo: "responsavel" | "vinculado"`.

## Dashboard e configurações

| Método | Rota | Roles | Descrição |
|---|---|---|---|
| GET | `/dashboard` | ADMIN | Totais de clientes, placas, recebimentos e atrasos |
| GET | `/configuracoes` | ADMIN, VENDEDOR | Percentuais e dados comerciais |
| PUT | `/configuracoes` | ADMIN | Atualiza percentuais, juros, multa e representante |

`PUT /configuracoes`

```json
{
  "percentualMenor": 12.5,
  "percentualMaior": 18,
  "valorReferencia": 50,
  "multaPercentual": 5,
  "jurosDiarios": 0.33,
  "representanteNome": "AgilLock"
}
```

## Clientes

| Método | Rota | Roles | Descrição |
|---|---|---|---|
| GET | `/clientes` | ADMIN, COLABORADOR | Lista clientes |
| GET | `/clientes/:id` | ADMIN, COLABORADOR | Detalhe do cliente |
| GET | `/clientes/:id/carnes` | ADMIN, COLABORADOR | Carnês e boletos do cliente |
| GET | `/clientes/:id/dispositivos` | ADMIN, COLABORADOR | Dispositivos do cliente |
| POST | `/clientes` | ADMIN, COLABORADOR | Cria cliente |
| PUT | `/clientes/:id` | ADMIN, COLABORADOR | Edita cliente |
| PATCH | `/clientes/:id/status` | ADMIN, COLABORADOR | Ativa/inativa |
| DELETE | `/clientes/:id` | ADMIN, COLABORADOR | Exclui cliente |

Campos principais de criação/edição:

```json
{
  "nome": "João Silva",
  "cpfCnpj": "12345678900",
  "telefone": "(85) 99999-9999",
  "email": "joao@email.com",
  "tipoPessoa": "PF",
  "dataNascimento": "1990-01-01",
  "rg": "123456",
  "profissao": "Motorista",
  "estadoCivil": "Solteiro",
  "emailCobranca": "financeiro@email.com",
  "origemCliente": "indicação",
  "vendedorId": "uuid",
  "cep": "60000-000",
  "logradouro": "Rua A",
  "numero": "100",
  "bairro": "Centro",
  "cidade": "Fortaleza",
  "estado": "CE"
}
```

Na criação, endereço básico é obrigatório para emissão EFI: `cep`, `logradouro`, `numero`, `bairro`, `cidade`, `estado`.

## Login do cliente

Rotas administrativas para liberar acesso ao portal/app do cliente.

| Método | Rota | Roles | Descrição |
|---|---|---|---|
| GET | `/clientes/:id/login` | ADMIN, COLABORADOR | Consulta login do cliente |
| POST | `/clientes/:id/login` | ADMIN, COLABORADOR | Cria login |
| PUT | `/clientes/:id/login` | ADMIN, COLABORADOR | Altera email/senha |
| PATCH | `/clientes/:id/login/status` | ADMIN, COLABORADOR | Ativa/inativa |
| DELETE | `/clientes/:id/login` | ADMIN, COLABORADOR | Remove login |

```json
{ "email": "cliente@email.com", "senha": "SenhaSegura123" }
```

Permissões granulares aplicáveis ao colaborador: `podeCriarLoginCliente`, `podeEditarLoginCliente`, `podeInativarLoginCliente`, `podeExcluirLoginCliente`.

## Placas

| Método | Rota | Roles | Descrição |
|---|---|---|---|
| GET | `/clientes/:clienteId/placas` | ADMIN, COLABORADOR | Lista placas do cliente |
| POST | `/clientes/:clienteId/placas` | ADMIN, COLABORADOR | Cria placa |
| PUT | `/placas/:id` | ADMIN, COLABORADOR | Edita placa |
| PATCH | `/placas/:id/valor` | ADMIN, COLABORADOR | Valor mensal padrão |
| PATCH | `/placas/:id/status` | ADMIN, COLABORADOR | Ativa/inativa |
| DELETE | `/placas/:id` | ADMIN, COLABORADOR | Exclui |

`PATCH /placas/:id/valor`

```json
{ "valor": 75 }
```

## Dispositivos

Dispositivos substituem placas no módulo de rastreamento e também podem gerar cobranças.

| Método | Rota | Roles | Descrição |
|---|---|---|---|
| GET | `/dispositivos` | ADMIN, COLABORADOR | Lista dispositivos |
| GET | `/dispositivos/:id` | ADMIN, COLABORADOR | Detalhe do dispositivo |
| POST | `/dispositivos` | ADMIN, COLABORADOR | Cria dispositivo e sincroniza no Traccar |
| PUT | `/dispositivos/:id` | ADMIN, COLABORADOR | Edita e sincroniza no Traccar |
| PATCH | `/dispositivos/:id/status` | ADMIN, COLABORADOR | Ativa/inativa |
| PATCH | `/dispositivos/:id/vincular` | ADMIN, COLABORADOR | Vincula cliente principal |
| POST | `/dispositivos/:id/clientes` | ADMIN, COLABORADOR | Adiciona cliente vinculado |
| DELETE | `/dispositivos/:id/clientes/:clienteId` | ADMIN, COLABORADOR | Remove cliente vinculado |
| PATCH | `/dispositivos/:id/valor` | ADMIN, COLABORADOR | Valor mensal padrão |
| DELETE | `/dispositivos/:id` | ADMIN, COLABORADOR | Exclui local e Traccar |

`POST` e `PUT` usam `multipart/form-data` quando houver imagem. Campo de arquivo: `imagem`.

Campos principais:

```json
{
  "nome": "Tracker Hilux",
  "identificador": "359999999999999",
  "categoria": "car",
  "modeloRastreador": "GT06",
  "telefoneRastreador": "+558599999999",
  "iccid": "8955...",
  "operadora": "Vivo",
  "placa": "ABC-1234",
  "marca": "Toyota",
  "modeloVeiculo": "Hilux",
  "cor": "Prata",
  "limiteVelocidade": 100,
  "clienteId": "uuid",
  "vendedorId": "uuid",
  "valorPadrao": 120
}
```

## Motoristas

| Método | Rota | Roles | Descrição |
|---|---|---|---|
| GET | `/motoristas` | ADMIN, COLABORADOR | Lista motoristas |
| GET | `/motoristas/:id` | ADMIN, COLABORADOR | Detalhe |
| POST | `/motoristas` | ADMIN, COLABORADOR | Cria motorista e, se aplicável, driver no Traccar |
| PUT | `/motoristas/:id` | ADMIN, COLABORADOR | Edita |
| PATCH | `/motoristas/:id/status` | ADMIN, COLABORADOR | Ativa/inativa |
| DELETE | `/motoristas/:id` | ADMIN, COLABORADOR | Exclui |
| POST | `/motoristas/:id/vincular` | ADMIN, COLABORADOR | Vincula a dispositivo |
| DELETE | `/motoristas/:id/vincular/:dispositivoId` | ADMIN, COLABORADOR | Remove vínculo |

## Cobranças, carnês e boletos

| Método | Rota | Roles | Descrição |
|---|---|---|---|
| POST | `/carnes` | ADMIN, COLABORADOR | Gera carnê individual |
| GET | `/carnes/:id/pdf` | ADMIN, COLABORADOR | Link/PDF do carnê |
| DELETE | `/carnes/:id` | ADMIN, COLABORADOR | Cancela carnê |
| POST | `/carnes/unificar` | ADMIN, COLABORADOR | Unifica cobranças automaticamente |
| POST | `/carnes/unificar-placas` | ADMIN, COLABORADOR | Boleto unificado por placas |
| POST | `/carnes/unificar-dispositivos` | ADMIN, COLABORADOR | Boleto unificado por dispositivos |
| GET | `/boletos` | ADMIN, COLABORADOR | Lista boletos |
| GET | `/boletos/:id` | ADMIN, COLABORADOR, VENDEDOR | Detalhe |
| PATCH | `/boletos/:id/editar` | ADMIN, COLABORADOR | Edita vencimento/valor |
| PATCH | `/boletos/:id/baixa` | ADMIN, COLABORADOR | Baixa manual |
| PATCH | `/boletos/:id/cancelar` | ADMIN, COLABORADOR | Cancela boleto |

`GET /boletos` aceita:

```text
busca=texto
status=PAGO|ATRASADO|PENDENTE|CANCELADO|REEMBOLSADO|aberto|hoje
tipo=INDIVIDUAL|UNIFICADO
dataVencDe=YYYY-MM-DD
dataVencAte=YYYY-MM-DD
```

`POST /carnes`

```json
{
  "clienteId": "uuid",
  "placaId": "uuid",
  "dispositivoId": "uuid",
  "valor": 120,
  "dataVencimento": "2026-05-10",
  "numeroParcelas": 12,
  "vendedorId": "uuid"
}
```

Use `placaId` ou `dispositivoId`, conforme origem da cobrança.

## Segunda via e EFI

| Método | Rota | Auth | Descrição |
|---|---|---|---|
| GET | `/segunda-via?busca=...` | Público | Consulta boletos em aberto por CPF/CNPJ ou placa |
| POST | `/efi/webhook` | Público | Webhook EFI para baixa automática |
| GET | `/admin/migrar-efi/preview` | ADMIN | Prévia de migração EFI |
| POST | `/admin/migrar-efi` | ADMIN | Importa histórico EFI |
| POST | `/admin/corrigir-links-efi` | ADMIN | Corrige links de boletos |

Webhook EFI esperado:

```json
{ "notification_token": "token" }
```

## Contratos

| Método | Rota | Roles | Descrição |
|---|---|---|---|
| POST | `/contratos/preview` | ADMIN, COLABORADOR | Gera HTML prévio |
| POST | `/contratos/view-pdf` | ADMIN, COLABORADOR | Renderiza PDF temporário |
| GET | `/contratos` | ADMIN, COLABORADOR | Lista |
| GET | `/contratos/:id` | ADMIN, COLABORADOR | Detalhe |
| GET | `/contratos/:id/download` | ADMIN, COLABORADOR | Download |
| GET | `/contratos/:id/pdf` | ADMIN, COLABORADOR | PDF |
| POST | `/contratos` | ADMIN, COLABORADOR | Cria contrato |
| PUT | `/contratos/:id` | ADMIN, COLABORADOR | Edita |
| POST | `/contratos/:id/enviar` | ADMIN, COLABORADOR | Envia para assinatura Clicksign |
| GET | `/contratos/:id/debug-signers` | ADMIN, COLABORADOR | Diagnóstico de signatários |
| POST | `/contratos/:id/notificar/:signerId` | ADMIN, COLABORADOR | Reenvia notificação |
| POST | `/contratos/:id/cancelar` | ADMIN, COLABORADOR | Cancela |
| DELETE | `/contratos/:id` | ADMIN, COLABORADOR | Exclui |

Webhook Clicksign:

| Método | Rota | Auth | Descrição |
|---|---|---|---|
| POST | `/webhooks/clicksign` | Público | Atualiza status de assinatura |

## Usuários internos e vendedores

| Método | Rota | Roles | Descrição |
|---|---|---|---|
| GET | `/colaboradores` | ADMIN | Lista colaboradores |
| POST | `/colaboradores` | ADMIN | Cria colaborador |
| PUT | `/colaboradores/:id` | ADMIN | Edita |
| PATCH | `/colaboradores/:id/status` | ADMIN | Ativa/inativa |
| DELETE | `/colaboradores/:id` | ADMIN | Exclui |
| GET | `/vendedores` | ADMIN, COLABORADOR | Lista vendedores |
| POST | `/vendedores` | ADMIN | Cria vendedor |
| PUT | `/vendedores/:id` | ADMIN | Edita |
| PATCH | `/vendedores/:id/status` | ADMIN | Ativa/inativa |
| DELETE | `/vendedores/:id` | ADMIN | Exclui |
| GET | `/vendedores/:id/clientes` | ADMIN | Clientes do vendedor |

Permissões principais de colaborador:

```json
{
  "podeExcluirCliente": true,
  "podeEditarCliente": true,
  "podeInativarCliente": true,
  "podeExcluirPlaca": true,
  "podeInativarPlaca": true,
  "podeExcluirDispositivo": true,
  "podeInativarDispositivo": true,
  "podeCriarDispositivo": true,
  "podeEditarDispositivo": true,
  "podeDesvincularDispositivo": true,
  "podeBaixaManual": true,
  "podeCancelarCarne": true,
  "podeAlterarVencimento": true,
  "podeCriarContrato": true,
  "podeEditarContrato": true,
  "podeExcluirContrato": true,
  "podeAcessarMonitoramento": false
}
```

## Carteira do vendedor

| Método | Rota | Roles | Descrição |
|---|---|---|---|
| GET | `/vendedor/carteira` | VENDEDOR, ADMIN | Totais garantido/atrasado/futuro |
| GET | `/vendedor/carteira/detalhes` | VENDEDOR, ADMIN | Itens detalhados |
| GET | `/vendedor/carteira/exportar` | VENDEDOR, ADMIN | CSV |
| GET | `/vendedor/pagamentos` | VENDEDOR, ADMIN | Registro de pagamento do mês |
| POST | `/vendedor/pagamentos` | ADMIN | Cria/atualiza pagamento |
| POST | `/vendedor/pagamentos/:id/comprovante` | ADMIN | Upload de comprovante |
| GET | `/vendedor/comprovante/:id` | VENDEDOR, ADMIN | Visualiza comprovante |

`GET /vendedor/carteira?mes=2026-05&vendedorId=uuid`

```json
{
  "mes": "2026-05",
  "garantido": { "total": 150, "pct12": 50, "pct18": 100 },
  "atrasado": { "total": 80, "pct12": 30, "pct18": 50 },
  "futuro": { "total": 200, "pct12": 80, "pct18": 120 }
}
```

## Rastreamento - admin/colaborador

Detalhes completos em `docs/traccar/API.md`.

| Método | Rota | Roles | Descrição |
|---|---|---|---|
| GET | `/rastreamento/geocode/reverse` | ADMIN, COLABORADOR | Reverse geocode por lat/lon |
| GET | `/rastreamento/posicoes` | ADMIN, COLABORADOR | Snapshot de dispositivos ativos |
| GET | `/rastreamento/dispositivos/:id/historico` | ADMIN, COLABORADOR | Rota/histórico |
| GET | `/rastreamento/dispositivos/:id/viagens` | ADMIN, COLABORADOR | Viagens |
| GET | `/rastreamento/dispositivos/:id/paradas` | ADMIN, COLABORADOR | Paradas |
| GET | `/rastreamento/dispositivos/:id/eventos` | ADMIN, COLABORADOR | Eventos |
| GET | `/rastreamento/dispositivos/:id/resumo` | ADMIN, COLABORADOR | Resumo |
| GET | `/rastreamento/dispositivos/:id/tipos-comandos` | ADMIN, COLABORADOR | Tipos de comando |
| POST | `/rastreamento/dispositivos/:id/comandos` | ADMIN, COLABORADOR | Envia comando |
| PATCH | `/rastreamento/dispositivos/:id/medidores` | ADMIN, COLABORADOR | Ajusta odômetro/horímetro do sistema |
| GET | `/rastreamento/dispositivos/:id/detalhe` | ADMIN, COLABORADOR | Detalhe enriquecido |
| GET | `/rastreamento/logs` | ADMIN, COLABORADOR | Últimos logs Traccar |

## Geocercas - admin/colaborador

| Método | Rota | Roles | Descrição |
|---|---|---|---|
| GET | `/rastreamento/cercas` | ADMIN, COLABORADOR | Lista simples compatível com Traccar |
| GET | `/rastreamento/dispositivos/:id/cercas` | ADMIN, COLABORADOR | Cercas do dispositivo |
| POST | `/rastreamento/cercas` | ADMIN, COLABORADOR | Cria cerca simples |
| DELETE | `/rastreamento/cercas/:id` | ADMIN, COLABORADOR | Remove cerca simples |
| DELETE | `/rastreamento/cercas/:id/dispositivos/:dispositivoId` | ADMIN, COLABORADOR | Desvincula cerca |
| GET | `/rastreamento/geocercas` | ADMIN, COLABORADOR | Lista gerencial |
| GET | `/rastreamento/geocercas/:id` | ADMIN, COLABORADOR | Detalhe |
| POST | `/rastreamento/geocercas` | ADMIN, COLABORADOR | Cria geocerca |
| PUT | `/rastreamento/geocercas/:id` | ADMIN, COLABORADOR | Edita geocerca |
| DELETE | `/rastreamento/geocercas/:id` | ADMIN, COLABORADOR | Exclui geocerca |

Payload gerencial:

```json
{
  "nome": "Casa",
  "descricao": "Raio de segurança",
  "area": "CIRCLE (-3.73 -38.52, 300)",
  "tipo": "circulo",
  "dispositivos": ["uuid"],
  "visivelCliente": true,
  "notificarCliente": true,
  "sistemasNotif": { "web": true, "app": true, "email": false },
  "dataInicio": "2026-05-03T00:00:00-03:00",
  "ativa": true
}
```

## Relatórios de rastreamento em lote

| Método | Rota | Roles | Descrição |
|---|---|---|---|
| GET | `/rastreamento/relatorios/batch/historico` | ADMIN, COLABORADOR | Histórico de múltiplos dispositivos |
| GET | `/rastreamento/relatorios/batch/viagens` | ADMIN, COLABORADOR | Viagens em lote |
| GET | `/rastreamento/relatorios/batch/paradas` | ADMIN, COLABORADOR | Paradas em lote |
| GET | `/rastreamento/relatorios/batch/eventos` | ADMIN, COLABORADOR | Eventos em lote |
| GET | `/rastreamento/relatorios/batch/resumo` | ADMIN, COLABORADOR | Resumo em lote |
| GET | `/rastreamento/relatorios/exportar` | ADMIN, COLABORADOR | XLSX exportado pelo Traccar |

Query:

```text
from=2026-05-03T00:00:00-03:00
to=2026-05-03T23:59:59-03:00
deviceId=1,2,3
type=route|events|trips|stops|summary
```

No admin, `deviceId` é o ID inteiro do Traccar.

## Portal do cliente e app mobile

Estas rotas são a base direta para o app React Native Expo.

Todas usam JWT `CLIENTE`.

| Método | Rota | Perfil | Descrição |
|---|---|---|---|
| GET | `/cliente/rastreamento/status-acesso` | CLIENTE | Bloqueio por inadimplência |
| GET | `/cliente/rastreamento/prefs` | CLIENTE | Preferências do login |
| POST | `/cliente/rastreamento/prefs` | CLIENTE | Substitui preferências |
| POST | `/cliente/rastreamento/prefs/merge` | CLIENTE | Mescla preferências |
| GET | `/cliente/rastreamento/posicoes` | CLIENTE | Snapshot filtrado pelo cliente |
| GET | `/cliente/rastreamento/geocode/reverse` | CLIENTE | Reverse geocode |
| GET | `/cliente/rastreamento/dispositivos/:id/historico` | CLIENTE | Histórico |
| GET | `/cliente/rastreamento/dispositivos/:id/viagens` | CLIENTE | Viagens |
| GET | `/cliente/rastreamento/dispositivos/:id/paradas` | CLIENTE | Paradas |
| GET | `/cliente/rastreamento/dispositivos/:id/eventos` | CLIENTE | Eventos |
| GET | `/cliente/rastreamento/dispositivos/:id/resumo` | CLIENTE | Resumo |
| GET | `/cliente/rastreamento/relatorios/batch/historico` | CLIENTE | Histórico em lote |
| GET | `/cliente/rastreamento/relatorios/batch/viagens` | CLIENTE | Viagens em lote |
| GET | `/cliente/rastreamento/relatorios/batch/paradas` | CLIENTE | Paradas em lote |
| GET | `/cliente/rastreamento/relatorios/batch/eventos` | CLIENTE | Eventos em lote |
| GET | `/cliente/rastreamento/relatorios/batch/resumo` | CLIENTE | Resumo em lote |
| GET | `/cliente/rastreamento/dispositivos/:id/exportar` | CLIENTE | Exportação de um dispositivo |
| GET | `/cliente/rastreamento/relatorios/exportar` | CLIENTE | Exportação em lote |
| GET | `/cliente/boletos` | CLIENTE responsável | Boletos do cliente |
| POST | `/cliente/dispositivos/:dispositivoId/foto` | CLIENTE | Upload de foto do veículo |
| DELETE | `/cliente/dispositivos/:dispositivoId/foto` | CLIENTE | Remove foto do veículo |
| GET | `/cliente/dispositivos/:dispositivoId/tipos-comandos` | CLIENTE | Tipos de comando |
| POST | `/cliente/dispositivos/:dispositivoId/comandos` | CLIENTE | Envia comando |

Diferenças importantes para o app:

- Todas as rotas de rastreamento do cliente validam se o dispositivo pertence ao cliente principal ou está em `DispositivoCliente`.
- Se houver boleto `ATRASADO` com mais de 10 dias, rotas de rastreamento retornam `403 { "error": "acesso_bloqueado" }`.
- `GET /cliente/rastreamento/posicoes` retorna `podeGerenciarManutencao` por dispositivo.
- Para relatórios em lote do cliente, `deviceId` usa IDs locais (`dispositivoId`) e o backend converte para `traccarId`.

## Geocercas do cliente

| Método | Rota | Perfil | Descrição |
|---|---|---|---|
| GET | `/cliente/rastreamento/cercas` | CLIENTE | Cercas visíveis no mapa |
| GET | `/cliente/rastreamento/dispositivos/:dispositivoId/cercas` | CLIENTE | Cercas do dispositivo |
| POST | `/cliente/rastreamento/cercas` | CLIENTE | Cria cerca simples |
| DELETE | `/cliente/rastreamento/cercas/:id` | CLIENTE | Remove cerca simples do cliente |
| GET | `/cliente/rastreamento/geocercas` | CLIENTE | Lista geocercas próprias |
| GET | `/cliente/rastreamento/geocercas/:id` | CLIENTE | Detalhe |
| POST | `/cliente/rastreamento/geocercas` | CLIENTE | Cria geocerca própria |
| PUT | `/cliente/rastreamento/geocercas/:id` | CLIENTE | Edita geocerca própria |
| DELETE | `/cliente/rastreamento/geocercas/:id` | CLIENTE | Exclui geocerca própria |

O cliente só pode editar/remover geocercas com `origemTipo = "CLIENTE"` e `clienteId` igual ao token.

## Notificações do cliente

| Método | Rota | Perfil | Descrição |
|---|---|---|---|
| GET | `/cliente/notificacoes/preferencias/:dispositivoId` | CLIENTE | Preferências por dispositivo |
| POST | `/cliente/notificacoes/preferencias` | CLIENTE | Salva preferência de evento |
| PATCH | `/cliente/notificacoes/km-troca-oleo/:dispositivoId` | CLIENTE | Configura km de troca de óleo |
| POST | `/cliente/notificacoes/confirmar-troca-oleo/:dispositivoId` | CLIENTE | Confirma troca e redefine base |
| GET | `/cliente/notificacoes/km-config/:dispositivoId` | CLIENTE | Configurações de km |
| GET | `/cliente/notificacoes/eventos` | CLIENTE | Lista eventos/notificações |

Eventos usados:

```text
ignitionOn, ignitionOff, geofenceEnter, geofenceExit, overspeed,
powerCut, kmExcedida, kmReduzida, trocaOleo, deviceLocked, deviceUnlocked
```

Canais por preferência: `web`, `app`, `email`.

## Notificações admin

| Método | Rota | Roles | Descrição |
|---|---|---|---|
| GET | `/notificacoes-admin/admin-prefs` | ADMIN, COLABORADOR | Preferências da tela admin |
| POST | `/notificacoes-admin/admin-prefs` | ADMIN, COLABORADOR | Salva preferências |
| POST | `/notificacoes-admin/admin-prefs/merge` | ADMIN, COLABORADOR | Mescla preferências |
| GET | `/notificacoes-admin/clientes` | ADMIN, COLABORADOR | Clientes com login |
| GET | `/notificacoes-admin/clientes/:clienteLoginId/dispositivos` | ADMIN, COLABORADOR | Dispositivos por cliente |
| GET | `/notificacoes-admin/clientes/:clienteLoginId/preferencias/:dispositivoId` | ADMIN, COLABORADOR | Preferências |
| POST | `/notificacoes-admin/clientes/:clienteLoginId/preferencias` | ADMIN, COLABORADOR | Salva preferência |
| PATCH | `/notificacoes-admin/clientes/:clienteLoginId/km-troca-oleo/:dispositivoId` | ADMIN, COLABORADOR | Configura troca de óleo |
| GET | `/notificacoes-admin/clientes/:clienteLoginId/km-config/:dispositivoId` | ADMIN, COLABORADOR | Config de km |
| GET | `/notificacoes-admin/eventos` | ADMIN, COLABORADOR | Eventos |

## Manutenções do cliente

| Método | Rota | Perfil | Descrição |
|---|---|---|---|
| GET | `/cliente/manutencoes/registros` | CLIENTE | Lista registros |
| POST | `/cliente/manutencoes/registros` | CLIENTE | Cria registro |
| PUT | `/cliente/manutencoes/registros/:id` | CLIENTE | Edita registro |
| DELETE | `/cliente/manutencoes/registros/:id` | CLIENTE | Exclui registro |
| GET | `/cliente/manutencoes/recorrencias` | CLIENTE | Lista recorrências |
| POST | `/cliente/manutencoes/recorrencias` | CLIENTE | Cria recorrência |
| PUT | `/cliente/manutencoes/recorrencias/:id` | CLIENTE | Edita recorrência |
| POST | `/cliente/manutencoes/recorrencias/:id/feito` | CLIENTE | Marca como feita |
| DELETE | `/cliente/manutencoes/recorrencias/:id` | CLIENTE | Exclui recorrência |

Campos principais:

```json
{
  "dispositivoId": "uuid",
  "titulo": "Troca de óleo",
  "tipo": "preventiva",
  "descricao": "Óleo 5W30",
  "dataRealizacao": "2026-05-03",
  "kmRealizacao": 45000,
  "custo": 320,
  "oficina": "Oficina A",
  "notas": "Filtro incluso"
}
```

## Manutenções admin

| Método | Rota | Roles | Descrição |
|---|---|---|---|
| GET | `/manutencoes-admin/clientes` | ADMIN, COLABORADOR | Clientes com login |
| GET | `/manutencoes-admin/clientes/:clienteLoginId/dispositivos` | ADMIN, COLABORADOR | Dispositivos |
| GET | `/manutencoes-admin/clientes/:clienteLoginId/registros` | ADMIN, COLABORADOR | Registros do cliente |
| POST | `/manutencoes-admin/clientes/:clienteLoginId/registros` | ADMIN, COLABORADOR | Cria registro |
| PUT | `/manutencoes-admin/registros/:id` | ADMIN, COLABORADOR | Edita registro |
| DELETE | `/manutencoes-admin/registros/:id` | ADMIN, COLABORADOR | Exclui registro |
| GET | `/manutencoes-admin/clientes/:clienteLoginId/recorrencias` | ADMIN, COLABORADOR | Recorrências |
| POST | `/manutencoes-admin/clientes/:clienteLoginId/recorrencias` | ADMIN, COLABORADOR | Cria recorrência |
| PUT | `/manutencoes-admin/clientes/:clienteLoginId/recorrencias/:id` | ADMIN, COLABORADOR | Edita recorrência |
| POST | `/manutencoes-admin/clientes/:clienteLoginId/recorrencias/:id/feito` | ADMIN, COLABORADOR | Marca feita |
| DELETE | `/manutencoes-admin/clientes/:clienteLoginId/recorrencias/:id` | ADMIN, COLABORADOR | Exclui recorrência |
| GET | `/manutencoes-admin/todos/registros` | ADMIN, COLABORADOR | Todos os registros |
| POST | `/manutencoes-admin/bulk/recorrencias` | ADMIN, COLABORADOR | Criação em lote |

## Compartilhamento público

| Método | Rota | Auth | Descrição |
|---|---|---|---|
| POST | `/compartilhamento/gerar` | Público | Gera link/token de compartilhamento |
| GET | `/compartilhamento/:token/dados` | Público | Dados do compartilhamento |
| GET | `/compartilhamento/:token/historico` | Público | Histórico compartilhado |
| GET | `/compartilhamento/:token/geocode` | Público | Reverse geocode público |

## Uploads

| Origem | Campo | Limite | Tipos | Resposta |
|---|---|---|---|---|
| Dispositivo admin | `imagem` | configurado na rota | imagem | `imagemUrl` |
| Foto cliente | `foto` | 10 MB no backend atual | JPG, PNG, WEBP | `imagemUrlCliente` |
| Comprovante vendedor | `comprovante` | 10 MB | PDF, JPG, PNG, WEBP | registro atualizado |

## Observações para o app mobile

- O app deve usar `POST /auth/login` e armazenar apenas JWT de `role: CLIENTE`.
- Primeiro carregamento recomendado: `GET /cliente/rastreamento/status-acesso`, depois `GET /cliente/rastreamento/posicoes`, preferências, notificações e manutenções.
- Para tempo real, usar `ws(s)://api.agillock.com.br/ws/rastreamento`. O backend ainda transmite todos os eventos conectados; o app deve filtrar localmente por `traccarId` dos dispositivos recebidos em `/cliente/rastreamento/posicoes`.
- Para comandos sensíveis (`engineStop`, `engineResume`), implementar confirmação explícita no app antes de chamar `/cliente/dispositivos/:id/comandos`.
