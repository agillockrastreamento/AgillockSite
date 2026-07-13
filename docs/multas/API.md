# API

Rotas do backend. Convenções do projeto: respostas JSON, auth por JWT (admin: `auth.middleware`; cliente: `cliente-auth.middleware`). Valores monetários como número.

## Registro em `app.ts`
```ts
app.use('/api/multas', multasRoutes);              // admin (ADMIN/COLABORADOR)
// rotas do cliente: dentro de cliente-portal.routes.ts ou cliente-multas.routes.ts (JWT cliente)
```

---

## Admin

### `PATCH /api/clientes/:id/multas-habilitado`
Liga/desliga a consulta de multas do cliente (auto-toggle, **sem body**), igual a `medidores-permissao`.
- Auth: ADMIN/COLABORADOR.
- Ao **ligar:** cria/garante `VeiculoMultaSituacao` para os dispositivos do cliente que tenham renavam/chassi e dispara uma consulta inicial (assíncrona).
- Resposta: `{ multasHabilitado: boolean }`.

### `GET /api/multas`
Lista de situações de todos os clientes habilitados (alimenta a tela do admin).
- Query: `?busca=` (placa/nome/cpf), `?status=` (OK/ERRO/...), `?comMultas=true`, `?clienteId=`, paginação `?page=&limit=`.
- Resposta:
```json
{
  "itens": [{
    "dispositivoId": "...", "placa": "OSU6H88", "clienteNome": "...",
    "qtdMultas": 2, "valorTotal": 267.12,
    "possuiDebitoIpva": true, "licenciamentoPendente": false,
    "ultimaConsultaEm": "2026-06-26T13:00:05-03:00", "ultimaConsultaStatus": "OK"
  }],
  "total": 123, "page": 1
}
```

### `GET /api/multas/:dispositivoId`
Detalhe de um veículo: situação + tabela de multas + Pix/boleto (das todas).
```json
{
  "placa": "OSU6H88", "renavam": "0124...", "cliente": {...},
  "qtdMultas": 2, "valorTotal": 267.12,
  "possuiDebitoIpva": true, "licenciamentoPendente": false,
  "ultimaConsultaEm": "...", "ultimaConsultaStatus": "OK",
  "multas": [{
    "ait": "VM00331695", "motivo": "ESTACIONAR...", "dataInfracao": "23/12/2025",
    "dataVencimento": "13/04/2026", "valor": 130.16, "valorAPagar": 132.85,
    "selecaoValue": "213890*VM00331695*5550*0"
  }],
  "pix": { "emv": "...", "qrCodeBase64": "..." },
  "boletoUrl": "/uploads/multas/<id>/Extrato_6606260648.pdf"
}
```

### `POST /api/multas/:dispositivoId/consultar`
Consulta **sob demanda** (botão "buscar estado deste veículo"). Roda o fluxo no Detran na hora, atualiza o banco e retorna o mesmo payload de `GET /:dispositivoId`.

### `POST /api/multas/:dispositivoId/pagamento`
Gera Pix + boleto para um **subconjunto** de multas (à vista).
- Body: `{ "aits": ["VM00331695"] }` (ou `[]`/omitido = todas).
- Faz `emitir_extrato_multas` + `gerar_boleto` no Detran só para os AITs escolhidos.
- Resposta:
```json
{ "extratoId": "...", "pix": { "emv": "...", "qrCodeBase64": "..." }, "boletoUrl": "/uploads/multas/tmp/Extrato_xxx.pdf" }
```

### `GET /api/multas/:dispositivoId/boleto?aits=VM00331695,VM00311778`
Stream do PDF do boleto (`application/pdf`) para os AITs informados (todas se omitido). Regenera no Detran para garantir validade.

### Histórico (aba do admin)
### `GET /api/multas/historico`
Lista de execuções (`ConsultaMultaLog`), mais recentes primeiro.
- Query: paginação, `?origem=AGENDADA|MANUAL_ADMIN`, `?status=`.
- Resposta:
```json
{ "itens": [{
  "id": "...", "origem": "AGENDADA", "inicioEm": "2026-06-26T10:00:00-03:00",
  "fimEm": "2026-06-26T10:03:12-03:00", "duracaoMs": 192000, "status": "OK",
  "clientesConsultados": 18, "veiculosConsultados": 24,
  "veiculosComSucesso": 23, "veiculosComErro": 1, "multasColetadas": 41
}], "total": 200, "page": 1 }
```

### `POST /api/multas/consultar-todos`
Dispara a consulta em lote manualmente (mesmo que o scheduler faz). Cria um `ConsultaMultaLog` com `origem="MANUAL_ADMIN"`. Resposta imediata `{ logId }` (execução assíncrona).

---

## Cliente (JWT do cliente)

Disponíveis **somente** se `cliente.multasHabilitado === true` (senão 403/404).

### `GET /api/cliente/multas`
Situação de multas de **todos os veículos do cliente logado**.
```json
{
  "habilitado": true,
  "atualizadoEm": "2026-06-26T13:00:05-03:00",
  "podeEditarDocumentos": true,
  "incompletos": [{ "dispositivoId": "...", "placa": "ABC1D23", "apelido": "Fiorino" }],
  "aguardando":  [{ "dispositivoId": "...", "placa": "XYZ4E56", "apelido": null }],
  "veiculos": [{
    "dispositivoId": "...", "placa": "OSU6H88", "apelido": "...",
    "qtdMultas": 2, "valorTotal": 267.12,
    "possuiDebitoIpva": true, "licenciamentoPendente": false,
    "multas": [{ "ait": "...", "motivo": "...", "dataInfracao": "...", "dataVencimento": "...", "valor": 130.16, "valorAPagar": 132.85, "selecaoValue": "..." }]
  }]
}
```
- `incompletos` — veículos ativos com placa mas **sem renavam e sem chassi** (o Detran não consegue identificá-los). Alimentam o banner de "completar cadastro".
- `aguardando` — veículos já com renavam/chassi mas **sem a 1ª consulta** ainda (job na fila do worker).
- `podeEditarDocumentos` — reflete a permissão `multas.editarDocumentos` (responsável sempre `true`). Sem ela, o sub-usuário vê o banner, mas sem o botão.

### `PATCH /api/cliente/multas/:dispositivoId/documentos`
Grava renavam e/ou chassi no **cadastro do dispositivo** (é de lá que a consulta lê os dados) e enfileira a 1ª consulta (`ConsultaJob` com `origem="CLIENTE"`).

- Exige a permissão **`multas.editarDocumentos`** (`requirePermission`) e que o dispositivo seja do próprio cliente.
- Body: `{ "renavam": "12345678901", "chassi": "9BWZZZ377VT004251" }` — ao menos um dos dois.
- Validação: renavam 9–11 dígitos; chassi 17 caracteres `[A-HJ-NPR-Z0-9]` (sem I, O, Q).
- Resposta: `{ "id": "...", "dispositivoId": "...", "placa": "...", "renavam": "...", "chassi": "...", "consultaEnfileirada": true }`.

### `POST /api/cliente/multas/:dispositivoId/pagamento`
Igual ao admin: gera Pix + boleto para `{ aits: [...] }` (vazio = todas). Valida que o dispositivo pertence ao cliente.
- Resposta: `{ extratoId, pix: { emv, qrCodeBase64 }, boletoUrl }`.

### `GET /api/cliente/multas/:dispositivoId/boleto?aits=...`
Stream do PDF (valida posse do dispositivo).

> O cliente **não** dispara consulta ao Detran (só admin/scheduler). O cliente lê o estado já consultado e gera Pix/boleto para pagar.

---

## Erros e status

| Situação | Comportamento |
|---|---|
| Placa/renavam divergentes no Detran (`errors` no login) | `ultimaConsultaStatus="DADOS_INVALIDOS"`; API retorna 200 com situação marcada |
| Dispositivo sem renavam/chassi | `ultimaConsultaStatus="SEM_RENAVAM"`; não consulta |
| Detran fora do ar / 403 / timeout | `ultimaConsultaStatus="ERRO"` + `ultimaConsultaErro`; mantém último dado bom |
| Cliente não habilitado acessando rota de cliente | 403 |
