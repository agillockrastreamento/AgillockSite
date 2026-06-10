-- Integração IAPRO: marca clientes vindos da IAPRO e registra seus veículos
-- (sincronizados ao gerar contrato lá). Sem boletos aqui — cobrança é da IAPRO.

-- AlterTable
ALTER TABLE "Cliente" ADD COLUMN "origemIapro" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Cliente" ADD COLUMN "iaproClienteId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Cliente_iaproClienteId_key" ON "Cliente"("iaproClienteId");

-- CreateTable
CREATE TABLE "IaproVeiculo" (
    "id" TEXT NOT NULL,
    "iaproVehicleId" TEXT NOT NULL,
    "iaproContractId" TEXT,
    "placa" TEXT,
    "marca" TEXT,
    "modelo" TEXT,
    "cor" TEXT,
    "ano" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "clienteId" TEXT NOT NULL,
    "dispositivoId" TEXT,

    CONSTRAINT "IaproVeiculo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IaproVeiculo_iaproVehicleId_key" ON "IaproVeiculo"("iaproVehicleId");
CREATE INDEX "IaproVeiculo_clienteId_idx" ON "IaproVeiculo"("clienteId");
CREATE INDEX "IaproVeiculo_placa_idx" ON "IaproVeiculo"("placa");

-- AddForeignKey
ALTER TABLE "IaproVeiculo" ADD CONSTRAINT "IaproVeiculo_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IaproVeiculo" ADD CONSTRAINT "IaproVeiculo_dispositivoId_fkey" FOREIGN KEY ("dispositivoId") REFERENCES "Dispositivo"("id") ON DELETE SET NULL ON UPDATE CASCADE;
