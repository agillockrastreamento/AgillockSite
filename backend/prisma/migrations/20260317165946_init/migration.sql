-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'COLABORADOR', 'VENDEDOR');

-- CreateEnum
CREATE TYPE "StatusCliente" AS ENUM ('ATIVO', 'INATIVO');

-- CreateEnum
CREATE TYPE "TipoCarne" AS ENUM ('INDIVIDUAL', 'UNIFICADO');

-- CreateEnum
CREATE TYPE "StatusBoleto" AS ENUM ('PENDENTE', 'PAGO', 'ATRASADO', 'CANCELADO');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "senhaHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cliente" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "cpfCnpj" TEXT,
    "telefone" TEXT,
    "email" TEXT,
    "notas" TEXT,
    "status" "StatusCliente" NOT NULL DEFAULT 'ATIVO',
    "cep" TEXT,
    "logradouro" TEXT,
    "numero" TEXT,
    "complemento" TEXT,
    "bairro" TEXT,
    "cidade" TEXT,
    "estado" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "criadoPorId" TEXT NOT NULL,
    "vendedorId" TEXT,

    CONSTRAINT "Cliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Placa" (
    "id" TEXT NOT NULL,
    "placa" TEXT NOT NULL,
    "descricao" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "clienteId" TEXT NOT NULL,

    CONSTRAINT "Placa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Carne" (
    "id" TEXT NOT NULL,
    "tipo" "TipoCarne" NOT NULL,
    "efiCarneId" TEXT,
    "efiCarneLink" TEXT,
    "valorTotal" DECIMAL(10,2) NOT NULL,
    "numeroParcelas" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "clienteId" TEXT NOT NULL,
    "geradoPorId" TEXT NOT NULL,

    CONSTRAINT "Carne_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Boleto" (
    "id" TEXT NOT NULL,
    "numeroParcela" INTEGER NOT NULL,
    "valor" DECIMAL(10,2) NOT NULL,
    "vencimento" TIMESTAMP(3) NOT NULL,
    "status" "StatusBoleto" NOT NULL DEFAULT 'PENDENTE',
    "dataPagamento" TIMESTAMP(3),
    "valorPago" DECIMAL(10,2),
    "efiChargeId" TEXT,
    "linkBoleto" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "carneId" TEXT NOT NULL,
    "placaId" TEXT,

    CONSTRAINT "Boleto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BoletoPlaca" (
    "valorPlaca" DECIMAL(10,2) NOT NULL,
    "boletoId" TEXT NOT NULL,
    "placaId" TEXT NOT NULL,

    CONSTRAINT "BoletoPlaca_pkey" PRIMARY KEY ("boletoId","placaId")
);

-- CreateTable
CREATE TABLE "ComissaoVendedor" (
    "id" TEXT NOT NULL,
    "valorReferencia" DECIMAL(10,2) NOT NULL,
    "percentualAplicado" DECIMAL(5,2) NOT NULL,
    "valorComissao" DECIMAL(10,2) NOT NULL,
    "pago" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vendedorId" TEXT NOT NULL,
    "boletoId" TEXT NOT NULL,

    CONSTRAINT "ComissaoVendedor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Configuracoes" (
    "id" TEXT NOT NULL DEFAULT '1',
    "percentualMenor" DECIMAL(5,2) NOT NULL DEFAULT 12.50,
    "percentualMaior" DECIMAL(5,2) NOT NULL DEFAULT 18.00,
    "valorReferencia" DECIMAL(10,2) NOT NULL DEFAULT 50.00,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Configuracoes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Carne_efiCarneId_key" ON "Carne"("efiCarneId");

-- CreateIndex
CREATE UNIQUE INDEX "Boleto_efiChargeId_key" ON "Boleto"("efiChargeId");

-- AddForeignKey
ALTER TABLE "Cliente" ADD CONSTRAINT "Cliente_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cliente" ADD CONSTRAINT "Cliente_vendedorId_fkey" FOREIGN KEY ("vendedorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Placa" ADD CONSTRAINT "Placa_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Carne" ADD CONSTRAINT "Carne_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Carne" ADD CONSTRAINT "Carne_geradoPorId_fkey" FOREIGN KEY ("geradoPorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Boleto" ADD CONSTRAINT "Boleto_carneId_fkey" FOREIGN KEY ("carneId") REFERENCES "Carne"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Boleto" ADD CONSTRAINT "Boleto_placaId_fkey" FOREIGN KEY ("placaId") REFERENCES "Placa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoletoPlaca" ADD CONSTRAINT "BoletoPlaca_boletoId_fkey" FOREIGN KEY ("boletoId") REFERENCES "Boleto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoletoPlaca" ADD CONSTRAINT "BoletoPlaca_placaId_fkey" FOREIGN KEY ("placaId") REFERENCES "Placa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComissaoVendedor" ADD CONSTRAINT "ComissaoVendedor_vendedorId_fkey" FOREIGN KEY ("vendedorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComissaoVendedor" ADD CONSTRAINT "ComissaoVendedor_boletoId_fkey" FOREIGN KEY ("boletoId") REFERENCES "Boleto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
