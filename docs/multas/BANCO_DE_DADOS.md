# Banco de dados

Modelos Prisma novos e alterações. Segue o estilo do schema atual (`backend/prisma/schema.prisma`).

## Alteração em `Cliente`

```prisma
model Cliente {
  // ...
  // Quando true, o cliente entra na rotina de consulta de multas (Detran) e
  // a tela "Multas" aparece no site e no app dele. Default desligado; admin liga caso a caso.
  multasHabilitado Boolean @default(false)
  // ...
  veiculosMultaSituacao VeiculoMultaSituacao[]
}
```
Mesmo padrão de `podeEditarMedidores`.

## `VeiculoMultaSituacao` — estado atual por veículo

Um registro por **dispositivo** habilitado. Atualizado a cada consulta.

```prisma
model VeiculoMultaSituacao {
  id        String @id @default(uuid())

  dispositivoId String      @unique
  dispositivo   Dispositivo @relation(fields: [dispositivoId], references: [id], onDelete: Cascade)
  clienteId     String
  cliente       Cliente     @relation(fields: [clienteId], references: [id], onDelete: Cascade)

  // snapshot da consulta
  placa        String
  renavam      String?
  uf           String  @default("CE")

  qtdMultas              Int     @default(0)
  valorTotal             Decimal @default(0) @db.Decimal(10, 2) // soma dos "valor a pagar"
  possuiDebitoIpva       Boolean @default(false)
  licenciamentoPendente  Boolean @default(false)

  // Extrato/pagamento de TODAS as multas (pré-gerado na consulta automática)
  extratoId       String?
  pixEmv          String?  // copia-e-cola
  pixQrCodeBase64 String?  // PNG base64 do QR
  boletoArquivo   String?  // caminho relativo em /uploads/multas/...

  // status da última consulta
  ultimaConsultaEm     DateTime?
  ultimaConsultaStatus String?   // "OK" | "ERRO" | "DADOS_INVALIDOS" | "SEM_RENAVAM"
  ultimaConsultaErro   String?

  multas    Multa[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([clienteId])
}
```

## `Multa` — item da tabela de multas

Substituídos (delete+insert) a cada consulta do veículo.

```prisma
model Multa {
  id String @id @default(uuid())

  situacaoId String
  situacao   VeiculoMultaSituacao @relation(fields: [situacaoId], references: [id], onDelete: Cascade)

  ait            String          // ex "VM00331695"
  aitOriginaria  String?         // geralmente "--"
  motivo         String
  dataInfracao   String?         // mantido como texto "dd/mm/aaaa" do Detran
  dataVencimento String?
  valor          Decimal  @db.Decimal(10, 2)        // "Valor"
  valorAPagar    Decimal  @db.Decimal(10, 2)        // "Valor a Pagar"

  // valor do checkbox usado para selecionar a multa no Detran (ex "213890*VM00331695*5550*0")
  selecaoValue   String

  createdAt DateTime @default(now())

  @@index([situacaoId])
  @@index([ait])
}
```

## `ConsultaMultaLog` — histórico de execuções

Um registro por execução do scheduler (e por execução manual em lote). Alimenta a aba "Histórico de consulta" do admin.

```prisma
model ConsultaMultaLog {
  id String @id @default(uuid())

  origem      String    // "AGENDADA" | "MANUAL_ADMIN"
  inicioEm    DateTime  @default(now())
  fimEm       DateTime?
  duracaoMs   Int?
  status      String    @default("EM_ANDAMENTO") // "OK" | "PARCIAL" | "ERRO" | "EM_ANDAMENTO"

  clientesConsultados  Int @default(0)
  veiculosConsultados  Int @default(0)
  veiculosComSucesso   Int @default(0)
  veiculosComErro      Int @default(0)
  multasColetadas      Int @default(0)

  detalhes Json? // por veículo: { placa, status, qtdMultas, erro? } — opcional, p/ depuração

  createdAt DateTime @default(now())

  @@index([inicioEm])
}
```

## `NotificacaoMultaEnvio` — dedup de notificações ao cliente

Evita repetir notificações (a rotina roda 2×/dia). Espelha `NotificacaoFinanceiraEnvio`. Detalhes e uso em [NOTIFICACOES](NOTIFICACOES.md).

```prisma
model NotificacaoMultaEnvio {
  id             String   @id @default(uuid())
  clienteLoginId String
  ait            String
  tipo           String   // "multaNova" | "multaVencimento7dias" | "multaVencimentoHoje"
  dataReferencia DateTime // dia de referência (00:00) p/ unicidade por dia
  createdAt      DateTime @default(now())

  clienteLogin ClienteLogin @relation(fields: [clienteLoginId], references: [id], onDelete: Cascade)

  @@unique([clienteLoginId, ait, tipo, dataReferencia])
}
```

> Notificações em si reutilizam o modelo existente `EventoNotificacao` (área de notificações/eventos do site e app; `adminEvento=true` para eventos do admin). Não criamos modelo novo para o evento — só para o dedup.

## Relações a adicionar

- `Dispositivo` → `veiculoMultaSituacao VeiculoMultaSituacao?` (1-para-1 opcional).
- `Cliente` → `veiculosMultaSituacao VeiculoMultaSituacao[]`.

## Migrações

Seguir o padrão de nomes do projeto (timestamp + nome):
- `..._add_cliente_multas_habilitado`
- `..._create_veiculo_multa_situacao`
- `..._create_multa`
- `..._create_consulta_multa_log`
- `..._create_notificacao_multa_envio`

(Podem ser uma única migração `..._consulta_multas_detran` que cria tudo.)

Aplicar com `npm run db:migrate` (dev) e `npm run db:deploy` (produção).

## Decisões

- **Sem histórico por multa ao longo do tempo:** guardamos só o **estado atual** (`VeiculoMultaSituacao` + `Multa`) e o **log de execuções**. Isso atende a tela do admin/cliente e a aba de histórico sem inflar o banco. Se no futuro quisermos histórico por multa, cria-se uma tabela append-only.
- **Datas como texto:** as datas do Detran (`dd/mm/aaaa`) são mantidas como string para fidelidade; se precisar ordenar/filtrar por data, derivar no parser.
- **`onDelete: Cascade`:** apagar um dispositivo/cliente remove a situação e as multas associadas.
