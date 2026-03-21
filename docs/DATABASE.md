# Schema do Banco de Dados

ORM: Prisma | Banco: PostgreSQL

---

## Diagrama de Entidades

```
User (ADMIN | COLABORADOR | VENDEDOR)
  │
  ├── cria → Cliente
  │             │
  │             ├── possui → Placa (1..N)
  │             └── possui → Carne (1..N)
  │                           │
  │                           └── possui → Boleto (1..N parcelas)
  │                                         │
  │                                         └── gera → ComissaoVendedor
  │
  └── responsável vendas → Cliente (vendedor_id)

Configuracoes (singleton — percentuais de comissão)
```

---

## Schema Prisma

```prisma
// prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

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
  INDIVIDUAL  // carnê vinculado a uma placa específica
  UNIFICADO   // carnê que agrega múltiplas placas
}

enum StatusBoleto {
  PENDENTE
  PAGO
  ATRASADO
  CANCELADO
}

model User {
  id         String   @id @default(uuid())
  nome       String
  email      String   @unique
  senhaHash  String
  role       Role
  ativo      Boolean  @default(true)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  // Permissões granulares (apenas para role COLABORADOR; ignoradas para ADMIN/VENDEDOR)
  podeExcluirCliente    Boolean @default(true)
  podeEditarCliente     Boolean @default(true)
  podeInativarCliente   Boolean @default(true)
  podeExcluirPlaca      Boolean @default(true)
  podeInativarPlaca     Boolean @default(true)
  podeBaixaManual       Boolean @default(true)
  podeCancelarCarne     Boolean @default(true)
  podeAlterarVencimento Boolean @default(true)

  // Relacionamentos
  clientesCriados  Cliente[]          @relation("ClienteCriador")
  clientesVendidos Cliente[]          @relation("ClienteVendedor")
  carnesGerados    Carne[]            @relation("CarneGeradoPor")
  carnesVendidos   Carne[]            @relation("CarneVendedor")
  placasVendidas   Placa[]            @relation("PlacaVendedor")
  comissoes        ComissaoVendedor[]
}

model Cliente {
  id          String        @id @default(uuid())
  nome        String
  cpfCnpj     String?
  telefone    String?
  email       String?
  notas       String?
  status      StatusCliente @default(ATIVO)
  // Endereço
  cep         String?
  logradouro  String?
  numero      String?
  complemento String?
  bairro      String?
  cidade      String?
  estado      String?

  // Relacionamentos
  criadoPorId String
  criadoPor   User   @relation("ClienteCriador", fields: [criadoPorId], references: [id])
  vendedorId  String?
  vendedor    User?  @relation("ClienteVendedor", fields: [vendedorId], references: [id])

  placas  Placa[]
  carnes  Carne[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model Placa {
  id          String        @id @default(uuid())
  clienteId   String
  cliente     Cliente       @relation(fields: [clienteId], references: [id])
  placa       String
  descricao   String?       // ex: "Carro preto Honda Civic"
  ativo       Boolean       @default(true)
  valorPadrao Decimal?      @db.Decimal(10,2)  // valor mensal padrão da placa (salvo no wizard)
  createdAt   DateTime      @default(now())
  updatedAt   DateTime      @updatedAt

  // Vendedor "dono" da placa: o primeiro que gerou cobrança para ela
  // Uma vez definido, permanece mesmo em cobranças futuras
  vendedorId  String?
  vendedor    User?         @relation("PlacaVendedor", fields: [vendedorId], references: [id])

  // Boletos vinculados a esta placa (carnês individuais)
  boletos           Boleto[]
  // Boletos unificados que incluem esta placa
  boletosUnificados BoletoPlaca[]
}

model Carne {
  id             String    @id @default(uuid())
  clienteId      String
  cliente        Cliente   @relation(fields: [clienteId], references: [id])
  geradoPorId    String
  geradoPor      User      @relation("CarneGeradoPor", fields: [geradoPorId], references: [id])
  // Vendedor responsável pelo carnê (informado no wizard ou herdado do cliente)
  vendedorId     String?
  vendedor       User?     @relation("CarneVendedor", fields: [vendedorId], references: [id])
  tipo           TipoCarne
  // Referência externa no EFI
  efiCarneId     String?   @unique
  efiCarneLink   String?   // link para download do PDF
  valorTotal     Decimal   @db.Decimal(10,2)
  numeroParcelas Int       @default(1)
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  boletos Boleto[]
}

model Boleto {
  id             String      @id @default(uuid())
  carneId        String
  carne          Carne       @relation(fields: [carneId], references: [id])
  // Placa associada (null para boleto unificado — usa BoletoPlaca)
  placaId        String?
  placa          Placa?      @relation(fields: [placaId], references: [id])
  numeroParcela  Int
  valor          Decimal     @db.Decimal(10,2)
  vencimento     DateTime
  status         StatusBoleto @default(PENDENTE)
  dataPagamento  DateTime?
  valorPago      Decimal?    @db.Decimal(10,2)
  // Referência externa no EFI
  efiChargeId    String?     @unique
  linkBoleto     String?     // URL para visualizar/pagar o boleto
  createdAt      DateTime    @default(now())
  updatedAt      DateTime    @updatedAt

  // Para boletos unificados
  placasUnificadas BoletoPlaca[]
  comissoes        ComissaoVendedor[]
}

// Relação M:N — Boleto Unificado ↔ Placas
model BoletoPlaca {
  boletoId   String
  boleto     Boleto @relation(fields: [boletoId], references: [id])
  placaId    String
  placa      Placa  @relation(fields: [placaId], references: [id])
  valorPlaca Decimal @db.Decimal(10,2) // valor individual desta placa dentro do boleto

  @@id([boletoId, placaId])
}

model ComissaoVendedor {
  id                 String   @id @default(uuid())
  vendedorId         String
  vendedor           User     @relation(fields: [vendedorId], references: [id])
  boletoId           String
  boleto             Boleto   @relation(fields: [boletoId], references: [id])
  // Valor de referência para cálculo (valor da placa, não do boleto unificado)
  valorReferencia    Decimal  @db.Decimal(10,2)
  percentualAplicado Decimal  @db.Decimal(5,2)
  valorComissao      Decimal  @db.Decimal(10,2)
  pago               Boolean  @default(false)
  createdAt          DateTime @default(now())
}

// Singleton de configurações (sempre ID = "1")
model Configuracoes {
  id                String  @id @default("1")
  percentualMenor   Decimal @db.Decimal(5,2) @default(12.50)  // comissão para valor < valorReferencia
  percentualMaior   Decimal @db.Decimal(5,2) @default(18.00)  // comissão para valor >= valorReferencia
  valorReferencia   Decimal @db.Decimal(10,2) @default(50.00)
  multaPercentual   Decimal @db.Decimal(5,2) @default(5.00)   // multa por atraso (% ao mês)
  jurosDiarios      Decimal @db.Decimal(5,2) @default(0.33)   // juros por atraso (% ao dia)
  updatedAt         DateTime @updatedAt
}
```

---

## Observações Importantes

1. **Carnê Unificado**: quando `tipo = UNIFICADO`, a coluna `placaId` do boleto fica `null` e as placas são listadas em `BoletoPlaca` com seus valores individuais.

2. **Cálculo de Comissão**: feito no momento em que o boleto é marcado como `PAGO`. A comissão é calculada **por placa**, usando `Placa.vendedorId` (não o vendedor do cliente). Para boletos unificados, itera sobre `BoletoPlaca` e gera um `ComissaoVendedor` por placa.

3. **Dono da Placa (`Placa.vendedorId`)**: definido na **primeira cobrança** gerada para aquela placa. Uma vez definido, não muda — todas as cobranças futuras da mesma placa continuam comissionando o mesmo vendedor, mesmo que a cobrança posterior indique outro.

3. **Recuperação de Clientes EFI**: o EFI não possui endpoint direto de clientes. Os clientes existentes serão importados consultando as cobranças (`GET /v1/charges`) e extraindo os dados do pagador (`customer`). Isso será uma migração única.

4. **Migrações**: rodar `npx prisma migrate dev` no desenvolvimento e `npx prisma migrate deploy` na produção via Docker entrypoint.
